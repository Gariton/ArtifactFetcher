import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as tar from 'tar';
import { ProgressBus, type PipPackage } from '@/lib/progressBus';
import { safeBundleName } from '@/lib/inputSafety';
import { assertFileSize, assertItemCount, ByteBudget } from '@/lib/resourceLimits';

const PYTHON_BIN = process.env.PIP_PYTHON_BIN || 'python3';

type PipDownloadOptions = {
    specs?: string[];
    requirementsText?: string;
    bundleName?: string;
    indexUrl?: string;
    extraIndexUrls?: string[];
    trustedHosts?: string[];
    username?: string;
    password?: string;
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

function spawnPython(args: string[], extraEnv: Record<string, string | undefined> = {}) {
    return spawn(PYTHON_BIN, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            PIP_DISABLE_PIP_VERSION_CHECK: '1',
            ...extraEnv,
        },
    });
}

async function collectMetadata(filePaths: string[]): Promise<PipPackage[]> {
    if (filePaths.length === 0) return [];
    const script = `import json, os, sys, tarfile, zipfile\n\n\nMAX_METADATA = 1024 * 1024\nSUPPORT_EXT = ('.whl', '.tar.gz', '.tar.bz2', '.tar.xz', '.zip', '.tgz', '.tar')\n\n\ndef checked_metadata(stream):\n    data = stream.read(MAX_METADATA + 1)\n    if len(data) > MAX_METADATA:\n        raise ValueError('metadata exceeds 1 MiB')\n    return parse_metadata_bytes(data)\n\n\ndef extract_metadata_from_wheel(path):\n    with zipfile.ZipFile(path) as zf:\n        for member in zf.namelist():\n            if member.endswith('METADATA'):\n                with zf.open(member) as f:\n                    return checked_metadata(f)\n    return {}\n\n\ndef extract_metadata_from_tar(path):\n    with tarfile.open(path, 'r:*') as tf:\n        candidates = [m for m in tf.getmembers() if m.isfile() and (m.name.endswith('PKG-INFO') or m.name.endswith('METADATA'))]\n        for member in candidates:\n            extracted = tf.extractfile(member)\n            if extracted is None:\n                continue\n            try:\n                return checked_metadata(extracted)\n            finally:\n                extracted.close()\n    return {}\n\n\ndef parse_metadata_bytes(raw):\n    text = raw.decode('utf-8', 'replace')\n    info = {}\n    for line in text.splitlines():\n        if line.lower().startswith('name:') and 'name' not in info:\n            info['name'] = line.split(':', 1)[1].strip()\n        elif line.lower().startswith('version:') and 'version' not in info:\n            info['version'] = line.split(':', 1)[1].strip()\n        if 'name' in info and 'version' in info:\n            break\n    return info\n\n\nitems = []\nfor arg in sys.argv[1:]:\n    path = os.path.abspath(arg)\n    entry = {\n        'filename': os.path.basename(path),\n        'size': os.path.getsize(path)\n    }\n    try:\n        if path.endswith('.whl'):\n            entry.update(extract_metadata_from_wheel(path))\n        elif path.endswith(SUPPORT_EXT):\n            entry.update(extract_metadata_from_tar(path))\n    except Exception as exc:\n        entry['error'] = str(exc)\n    items.append(entry)\n\nprint(json.dumps(items))\n`;

    const child = spawnPython(['-c', script, ...filePaths]);
    let stdout = '';
    let stderr = '';
    let outputError: Error | undefined;
    const timeout = setTimeout(() => {
        outputError = new Error('metadata extraction timed out');
        child.kill('SIGKILL');
    }, 2 * 60_000);
    timeout.unref?.();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.length > 5 * 1024 * 1024) {
            outputError = new Error('metadata output exceeds 5 MiB');
            child.kill('SIGKILL');
        }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-1024 * 1024); });

    const exitCode = await new Promise<number>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? -1));
    }).finally(() => clearTimeout(timeout));

    if (outputError) throw outputError;

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
    const lines = buffer.slice(-64 * 1024).split(/\r?\n/);
    const remainder = lines.pop();
    for (const line of lines) {
        const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (clean) onLine(clean);
    }
    return remainder ?? '';
}

async function runPipDownload(destDir: string, args: string[], bus: ProgressBus, extraEnv: Record<string, string | undefined> = {}) {
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

    const child = spawnPython(['-m', 'pip', 'download', ...args], extraEnv);
    let limitError: Error | undefined;
    let monitoring = false;
    const monitor = setInterval(() => {
        if (monitoring || limitError) return;
        monitoring = true;
        void (async () => {
            try {
                const names = await fs.promises.readdir(destDir);
                assertItemCount(names.length, 'pip download file');
                const budget = new ByteBudget();
                for (const name of names) {
                    const stat = await fs.promises.stat(path.join(destDir, name));
                    if (!stat.isFile()) continue;
                    assertFileSize(stat.size, `pip package ${name}`);
                    budget.consume(stat.size);
                }
            } catch (error) {
                limitError = error instanceof Error ? error : new Error('pip download resource limit exceeded');
                child.kill('SIGKILL');
            } finally {
                monitoring = false;
            }
        })();
    }, 250);
    monitor.unref?.();
    const timeout = setTimeout(() => {
        limitError = new Error('pip download timed out');
        child.kill('SIGKILL');
    }, 10 * 60_000);
    timeout.unref?.();

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
            stderrLines.push(line.slice(0, 8 * 1024));
            if (stderrLines.length > 200) stderrLines.splice(0, stderrLines.length - 200);
            parseLine(line);
        });
    });

    const exitCode = await new Promise<number>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? -1));
    }).finally(() => {
        clearInterval(monitor);
        clearTimeout(timeout);
    });

    if (limitError) throw limitError;

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

export function normalizePipIndexUrl(raw: string, username?: string, password?: string): string {
    let url: URL;
    try { url = new URL(raw.trim()); }
    catch { throw new Error('pip index URL is invalid'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('pip index URL must be HTTP(S) without credentials, query, or fragment');
    }
    if ((username || password) && url.protocol !== 'https:') {
        throw new Error('pip credentials require an HTTPS index URL');
    }
    if (username || password) {
        url.username = username || '__token__';
        url.password = password || '';
    }
    return url.toString();
}

export function normalizePipIndexUrls(
    indexUrl: string | undefined,
    extraIndexUrls: string[],
    username?: string,
    password?: string,
): { indexUrl?: string; extraIndexUrls: string[] } {
    const normalizedPrimary = indexUrl ? normalizePipIndexUrl(indexUrl, username, password) : undefined;
    const primaryOrigin = indexUrl ? new URL(normalizePipIndexUrl(indexUrl)).origin : undefined;
    return {
        indexUrl: normalizedPrimary,
        extraIndexUrls: extraIndexUrls.map((raw) => {
            const normalized = normalizePipIndexUrl(raw);
            const sameOrigin = Boolean(primaryOrigin && new URL(normalized).origin === primaryOrigin);
            return sameOrigin ? normalizePipIndexUrl(raw, username, password) : normalized;
        }),
    };
}

export function assertPipSpec(spec: unknown): string {
    const value = String(spec ?? '').trim();
    const directReference = value.includes('@')
        || /(?:^|\s)(?:https?|file|git\+|hg\+|svn\+|bzr\+):/i.test(value)
        || value.includes('://')
        || value.startsWith('.')
        || value.startsWith('/')
        || value.startsWith('~')
        || value.includes('\\');
    if (!value || value.length > 1024 || value.startsWith('-') || /[\0\r\n]/.test(value) || directReference) {
        throw new Error(`invalid pip package specification: ${value || '(empty)'}`);
    }
    return value;
}

export async function buildPipBundle({
    specs,
    requirementsText,
    bundleName = 'pip-offline',
    indexUrl,
    extraIndexUrls = [],
    trustedHosts = [],
    username,
    password,
    bus,
}: PipDownloadOptions) {
    if (!specs?.length && !requirementsText) {
        throw new Error('specs or requirementsText is required');
    }

    const requestedItems = (specs?.length ?? 0) + (requirementsText
        ? requirementsText.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')).length
        : 0);
    assertItemCount(requestedItems, 'pip requirement');
    const safeSpecs = specs?.map(assertPipSpec);
    if (requirementsText) {
        for (const line of requirementsText.split(/\r?\n/)) {
            const value = line.trim();
            if (!value || value.startsWith('#')) continue;
            try {
                assertPipSpec(value);
            } catch {
                throw new Error('requirements options, paths, VCS URLs, and direct references are not allowed; use registry package specifications');
            }
        }
    }
    const resolvedBundleName = safeBundleName(bundleName, 'pip-offline');
    bus.emitEvent({ type: 'stage', stage: 'pip-prepare' });

    const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pipdl-'));
    try {
        const bundleRoot = path.join(workRoot, resolvedBundleName);
        const packagesDir = path.join(bundleRoot, 'pip', 'packages');
        await fs.promises.mkdir(packagesDir, { recursive: true });

        let requirementsPath: string | undefined;
        if (requirementsText) {
            requirementsPath = path.join(bundleRoot, 'pip', 'requirements.txt');
            await fs.promises.writeFile(requirementsPath, requirementsText, 'utf8');
        }
        if (safeSpecs?.length) {
            await fs.promises.writeFile(path.join(bundleRoot, 'pip', 'specs.txt'), safeSpecs.join('\n'), 'utf8');
        }

        const pipConfigPath = path.join(workRoot, 'pip.conf');
        const configLines = ['[global]', 'disable-pip-version-check = true', 'no-input = true'];
        const normalizedIndexes = normalizePipIndexUrls(indexUrl, extraIndexUrls, username, password);
        if (normalizedIndexes.indexUrl) configLines.push(`index-url = ${normalizedIndexes.indexUrl}`);
        if (normalizedIndexes.extraIndexUrls.length) {
            configLines.push('extra-index-url =');
            for (const url of normalizedIndexes.extraIndexUrls) configLines.push(`    ${url}`);
        }
        if (trustedHosts.length) {
            configLines.push('trusted-host =');
            for (const host of trustedHosts) {
                if (!/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host)) throw new Error(`invalid trusted host: ${host}`);
                configLines.push(`    ${host}`);
            }
        }
        await fs.promises.writeFile(pipConfigPath, `${configLines.join('\n')}\n`, { mode: 0o600 });

        const downloadArgs: string[] = ['--dest', packagesDir, '--progress-bar', 'off', '--no-input'];
        if (!/^(1|true|on|yes)$/i.test(process.env.PIP_ALLOW_SOURCE_DISTRIBUTIONS || '')) {
            // sdists can execute build backends while pip prepares metadata.
            downloadArgs.push('--only-binary=:all:');
        }
        if (requirementsPath) downloadArgs.push('-r', requirementsPath);
        if (safeSpecs?.length) downloadArgs.push('--', ...safeSpecs);

        bus.emitEvent({ type: 'stage', stage: 'pip-download' });
        await runPipDownload(packagesDir, downloadArgs, bus, { PIP_CONFIG_FILE: pipConfigPath });

        const downloadedFiles = await fs.promises.readdir(packagesDir);
        const filePaths = downloadedFiles
            .filter((name) => /\.(whl|tar\.gz|tar\.bz2|tar\.xz|zip|tgz|tar)$/i.test(name))
            .map((name) => path.join(packagesDir, name));
        assertItemCount(filePaths.length, 'pip package');
        const budget = new ByteBudget();
        for (const filePath of filePaths) {
            const size = (await fs.promises.stat(filePath)).size;
            assertFileSize(size, `pip package ${path.basename(filePath)}`);
            budget.consume(size);
        }

        bus.emitEvent({ type: 'stage', stage: 'pip-collect-metadata' });
        const manifest = await collectMetadata(filePaths);
        await fs.promises.writeFile(path.join(bundleRoot, 'pip', 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
        bus.emitEvent({ type: 'manifest-resolved', items: manifest });

        bus.emitEvent({ type: 'tar-writing' });
        const filename = `${resolvedBundleName}.tar`;
        const tarPath = path.join(workRoot, filename);
        await tar.c({ cwd: bundleRoot, file: tarPath }, ['.']);

        return { tarPath, filename, workRoot, manifest };
    } catch (error) {
        try { await fs.promises.rm(workRoot, { recursive: true, force: true }); } catch {}
        throw error;
    }
}
