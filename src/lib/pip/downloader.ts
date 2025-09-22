import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as tar from 'tar';
import { ProgressBus, type PipPackage } from '@/lib/progressBus';

const PYTHON_BIN = process.env.PIP_PYTHON_BIN || 'python3';

type PipDownloadOptions = {
    specs?: string[];
    requirementsText?: string;
    bundleName?: string;
    pipArgs?: string[];
    bus: ProgressBus;
};

type DownloadEntry = {
    index: number;
    filename: string;
    size?: number;
};

function parseSize(text: string | undefined) {
    if (!text) return undefined;
    const match = /([0-9]+(?:\.[0-9]+)?)\s*([kKmMgGtT])?B?/.exec(text.trim());
    if (!match) return undefined;
    const value = parseFloat(match[1]);
    const unit = match[2]?.toLowerCase() ?? 'b';
    const factor = unit === 't' ? 1_000_000_000_000
        : unit === 'g' ? 1_000_000_000
        : unit === 'm' ? 1_000_000
        : unit === 'k' ? 1_000
        : 1;
    return Math.round(value * factor);
}

function spawnPython(args: string[]) {
    return spawn(PYTHON_BIN, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            PIP_DISABLE_PIP_VERSION_CHECK: '1',
        },
    });
}

async function collectMetadata(filePaths: string[]): Promise<PipPackage[]> {
    if (filePaths.length === 0) return [];
    const script = `import json, os, sys, tarfile, zipfile\n\n\nSUPPORT_EXT = ('.whl', '.tar.gz', '.tar.bz2', '.tar.xz', '.zip', '.tgz', '.tar')\n\n\ndef extract_metadata_from_wheel(path):\n    with zipfile.ZipFile(path) as zf:\n        for member in zf.namelist():\n            if member.endswith('METADATA'):\n                with zf.open(member) as f:\n                    return parse_metadata_bytes(f.read())\n    return {}\n\n\ndef extract_metadata_from_tar(path):\n    with tarfile.open(path, 'r:*') as tf:\n        candidates = [m for m in tf.getmembers() if m.isfile() and (m.name.endswith('PKG-INFO') or m.name.endswith('METADATA'))]\n        for member in candidates:\n            extracted = tf.extractfile(member)\n            if extracted is None:\n                continue\n            data = extracted.read()\n            extracted.close()\n            return parse_metadata_bytes(data)\n    return {}\n\n\ndef parse_metadata_bytes(raw):\n    text = raw.decode('utf-8', 'replace')\n    info = {}\n    for line in text.splitlines():\n        if line.lower().startswith('name:') and 'name' not in info:\n            info['name'] = line.split(':', 1)[1].strip()\n        elif line.lower().startswith('version:') and 'version' not in info:\n            info['version'] = line.split(':', 1)[1].strip()\n        if 'name' in info and 'version' in info:\n            break\n    return info\n\n\nitems = []\nfor arg in sys.argv[1:]:\n    path = os.path.abspath(arg)\n    entry = {\n        'filename': os.path.basename(path),\n        'size': os.path.getsize(path)\n    }\n    try:\n        if path.endswith('.whl'):\n            entry.update(extract_metadata_from_wheel(path))\n        elif path.endswith(SUPPORT_EXT):\n            entry.update(extract_metadata_from_tar(path))\n    except Exception as exc:\n        entry['error'] = str(exc)\n    items.append(entry)\n\nprint(json.dumps(items))\n`;

    const child = spawnPython(['-c', script, ...filePaths]);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const exitCode: number = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? -1));
    });

    if (exitCode !== 0) {
        throw new Error(`metadata extraction failed: ${stderr || stdout}`);
    }

    const parsed = JSON.parse(stdout) as Array<{ filename: string; size: number; name?: string; version?: string }>;
    return parsed.map((item) => ({
        name: item.name || item.filename,
        version: item.version || 'unknown',
        filename: item.filename,
        size: item.size,
    }));
}

function normalizeLineBuffer(buffer: string, onLine: (line: string) => void) {
    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop();
    for (const line of lines) {
        const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (clean) onLine(clean);
    }
    return remainder ?? '';
}

async function runPipDownload(destDir: string, args: string[], bus: ProgressBus) {
    const entries = new Map<string, DownloadEntry>();
    let bufferStdout = '';
    let bufferStderr = '';

    function ensureEntry(filename: string, size?: number) {
        const key = path.basename(filename);
        if (entries.has(key)) {
            const existing = entries.get(key)!;
            if (size && !existing.size) existing.size = size;
            return existing;
        }
        const entry: DownloadEntry = { index: entries.size, filename: key, size };
        entries.set(key, entry);
        bus.emitEvent({ type: 'item-start', scope: 'pip-download', index: entry.index, digest: key, total: size });
        return entry;
    }

    async function markDone(filename: string, size?: number) {
        const key = path.basename(filename);
        if (key.toLowerCase().endsWith('.metadata')) return;
        const entry = ensureEntry(key, size);
        const resolvedSize = size ?? entry.size ?? (await fs.promises.stat(path.join(destDir, key)).then((s) => s.size).catch(() => undefined));
        if (resolvedSize) {
            entry.size = resolvedSize;
            bus.emitEvent({ type: 'item-progress', scope: 'pip-download', index: entry.index, received: resolvedSize, total: resolvedSize });
        }
        bus.emitEvent({ type: 'item-done', scope: 'pip-download', index: entry.index });
    }

    function parseLine(line: string) {
        if (!line) return;
        if (/^Collecting\s+/i.test(line)) {
            bus.emitEvent({ type: 'stage', stage: line });
            return;
        }
        let match = line.match(/^Downloading\s+([^\s]+)\s+\(([^)]+)\)/i);
        if (match) {
            const filename = match[1];
            if (filename.toLowerCase().endsWith('.metadata')) return;
            const size = parseSize(match[2]);
            ensureEntry(filename, size);
            return;
        }
        match = line.match(/^Using cached\s+([^\s]+)\s+\(([^)]+)\)/i);
        if (match) {
            const filename = match[1];
            if (filename.toLowerCase().endsWith('.metadata')) return;
            const size = parseSize(match[2]);
            const entry = ensureEntry(filename, size);
            bus.emitEvent({ type: 'item-progress', scope: 'pip-download', index: entry.index, received: size ?? 0, total: size });
            bus.emitEvent({ type: 'item-done', scope: 'pip-download', index: entry.index });
            return;
        }
        match = line.match(/^Saved\s+(.*)$/i);
        if (match) {
            const filename = match[1].trim();
            void markDone(filename);
            return;
        }
        if (/^Requirement already satisfied:/i.test(line)) {
            bus.emitEvent({ type: 'stage', stage: line });
        }
    }

    const child = spawnPython(['-m', 'pip', 'download', ...args]);

    const stderrLines: string[] = [];

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
        bufferStdout += chunk;
        bufferStdout = normalizeLineBuffer(bufferStdout, parseLine);
    });
    child.stderr.on('data', (chunk) => {
        bufferStderr += chunk;
        bufferStderr = normalizeLineBuffer(bufferStderr, (line) => {
            stderrLines.push(line);
            parseLine(line);
        });
    });

    const exitCode: number = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? -1));
    });

    if (bufferStdout.trim()) {
        bufferStdout.split(/\r?\n/).forEach((line) => parseLine(line.trim()));
    }
    if (bufferStderr.trim()) {
        bufferStderr.split(/\r?\n/).forEach((line) => parseLine(line.trim()));
    }

    if (exitCode !== 0) {
        throw new Error(`pip download failed (exit ${exitCode}): ${stderrLines.join('\n')}`);
    }
}

export async function buildPipBundle({ specs, requirementsText, bundleName = 'pip-offline', pipArgs = [], bus }: PipDownloadOptions) {
    if (!specs?.length && !requirementsText) {
        throw new Error('specs or requirementsText is required');
    }

    bus.emitEvent({ type: 'stage', stage: 'pip-prepare' });

    const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pipdl-'));
    const bundleRoot = path.join(workRoot, bundleName);
    const packagesDir = path.join(bundleRoot, 'pip', 'packages');
    await fs.promises.mkdir(packagesDir, { recursive: true });

    let requirementsPath: string | undefined;
    if (requirementsText) {
        requirementsPath = path.join(bundleRoot, 'pip', 'requirements.txt');
        await fs.promises.writeFile(requirementsPath, requirementsText, 'utf8');
    }
    if (specs?.length) {
        await fs.promises.writeFile(path.join(bundleRoot, 'pip', 'specs.txt'), specs.join('\n'), 'utf8');
    }

    const downloadArgs: string[] = ['--dest', packagesDir, '--progress-bar', 'off', '--no-input', ...pipArgs];
    if (requirementsPath) downloadArgs.push('-r', requirementsPath);
    if (specs?.length) downloadArgs.push(...specs);

    bus.emitEvent({ type: 'stage', stage: 'pip-download' });
    await runPipDownload(packagesDir, downloadArgs, bus);

    const downloadedFiles = await fs.promises.readdir(packagesDir);
    const filePaths = downloadedFiles
        .filter((name) => /\.(whl|tar\.gz|tar\.bz2|tar\.xz|zip|tgz|tar)$/i.test(name))
        .map((name) => path.join(packagesDir, name));

    bus.emitEvent({ type: 'stage', stage: 'pip-collect-metadata' });
    const manifest = await collectMetadata(filePaths);
    await fs.promises.writeFile(path.join(bundleRoot, 'pip', 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    bus.emitEvent({ type: 'manifest-resolved', items: manifest });

    bus.emitEvent({ type: 'tar-writing' });
    const tarPath = path.join(workRoot, `${bundleName}.tar`);
    await tar.c({ cwd: bundleRoot, file: tarPath, sync: true }, ['.']);
    bus.emitEvent({ type: 'done', filename: `${bundleName}.tar` });

    return { tarPath, filename: `${bundleName}.tar`, workRoot, manifest };
}
