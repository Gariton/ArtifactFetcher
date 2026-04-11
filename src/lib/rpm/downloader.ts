import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as tar from 'tar';
import { ProgressBus, type RpmPackage } from '@/lib/progressBus';

export type RpmRepoPreset = {
    id: string;
    label: string;
    folderName: string;
    baseUrl: string;
};

export type RpmRepository = {
    id: string;
    label: string;
    folderName: string;
    baseUrl: string;
};

export const RPM_REPO_PRESETS: RpmRepoPreset[] = [
    { id: 'centos-stream-9-baseos', label: 'CentOS Stream 9 BaseOS (official)', folderName: 'CentOS Stream BaseOS', baseUrl: 'https://mirror.stream.centos.org/9-stream/BaseOS/x86_64/os/' },
    { id: 'centos-stream-9-appstream', label: 'CentOS Stream 9 AppStream (official)', folderName: 'CentOS Stream AppStream', baseUrl: 'https://mirror.stream.centos.org/9-stream/AppStream/x86_64/os/' },
    { id: 'epel-9-everything', label: 'EPEL 9 Everything', folderName: 'EPEL 9', baseUrl: 'https://dl.fedoraproject.org/pub/epel/9/Everything/x86_64/' },
];

type BuildRpmBundleOptions = {
    specs: string[];
    bundleName?: string;
    repositories: RpmRepository[];
    resolveDependencies?: boolean;
    bus: ProgressBus;
};

type RunOptions = {
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
};

type RpmNevra = {
    name: string;
    version: string;
    release: string;
    arch: string;
};

type RpmCommandPair = {
    downloadCmd: 'dnf' | 'dnf5';
    repoqueryCmd: 'dnf' | 'dnf5';
};

function streamLines(chunk: string, remainder: string, onLine?: (line: string) => void) {
    if (!onLine) return remainder + chunk;
    const text = remainder + chunk;
    const parts = text.split(/\r?\n/);
    const nextRemainder = parts.pop() ?? '';
    for (const line of parts) {
        const clean = line.trim();
        if (clean) onLine(clean);
    }
    return nextRemainder;
}

function run(cmd: string, args: string[], opts: RunOptions = {}) {
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let stdoutRemain = '';
        let stderrRemain = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            stdoutRemain = streamLines(chunk, stdoutRemain, opts.onStdoutLine);
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
            stderrRemain = streamLines(chunk, stderrRemain, opts.onStderrLine);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (opts.onStdoutLine && stdoutRemain.trim()) opts.onStdoutLine(stdoutRemain.trim());
            if (opts.onStderrLine && stderrRemain.trim()) opts.onStderrLine(stderrRemain.trim());
            resolve({ code: code ?? -1, stdout, stderr });
        });
    });
}

function sanitizeFolderName(name: string) {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

async function resolveRpmCommands(): Promise<RpmCommandPair> {
    const hasDnf = await run('dnf', ['--version']).catch(() => null);
    const hasDnf5 = await run('dnf5', ['--version']).catch(() => null);
    if ((!hasDnf || hasDnf.code !== 0) && (!hasDnf5 || hasDnf5.code !== 0)) {
        throw new Error('dnf/dnf5 command is required for rpm download. Please install dnf or dnf5.');
    }

    const dnfDownload = await run('dnf', ['download', '--help']).catch(() => null);
    const dnf5Download = await run('dnf5', ['download', '--help']).catch(() => null);
    const dnfRepoquery = await run('dnf', ['repoquery', '--help']).catch(() => null);
    const dnf5Repoquery = await run('dnf5', ['repoquery', '--help']).catch(() => null);

    const downloadCmd = dnfDownload && dnfDownload.code === 0
        ? 'dnf'
        : dnf5Download && dnf5Download.code === 0
            ? 'dnf5'
            : null;
    const repoqueryCmd = dnfRepoquery && dnfRepoquery.code === 0
        ? 'dnf'
        : dnf5Repoquery && dnf5Repoquery.code === 0
            ? 'dnf5'
            : null;

    if (!downloadCmd || !repoqueryCmd) {
        throw new Error('rpm download prerequisites are missing. Install dnf-plugins-core or dnf5 plugins (download/repoquery).');
    }

    return { downloadCmd, repoqueryCmd };
}

async function queryNevra(filePath: string): Promise<RpmNevra | null> {
    const result = await run('rpm', ['-qp', '--qf', '%{NAME}\t%{VERSION}\t%{RELEASE}\t%{ARCH}\n', filePath]).catch(() => null);
    if (!result || result.code !== 0) return null;
    const [line] = result.stdout.trim().split(/\r?\n/);
    if (!line) return null;
    const [name, version, release, arch] = line.split('\t').map((s) => s.trim());
    if (!name || !version || !release || !arch) return null;
    return { name, version, release, arch };
}

async function queryRepoId(nevra: RpmNevra, repoIds: string[], repoqueryCmd: 'dnf'|'dnf5'): Promise<string | undefined> {
    const args: string[] = ['repoquery', '--quiet', '--disablerepo=*'];
    for (const id of repoIds) args.push('--enablerepo', id);
    args.push('--qf', '%{repoid}', `${nevra.name}-${nevra.version}-${nevra.release}.${nevra.arch}`);
    const result = await run(repoqueryCmd, args).catch(() => null);
    if (!result || result.code !== 0) return undefined;
    const first = result.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first || undefined;
}

async function buildManifestAndLayout(files: string[], packagesDir: string, outputByRepoRoot: string, repos: RpmRepository[], repoqueryCmd: 'dnf'|'dnf5', bus: ProgressBus): Promise<RpmPackage[]> {
    const repoIds = repos.map((r) => r.id);
    const repoMap = new Map(repos.map((r) => [r.id, r]));
    const manifest: RpmPackage[] = [];

    for (const file of files) {
        const fullPath = path.join(packagesDir, file);
        const stat = await fs.promises.stat(fullPath);
        const nevra = await queryNevra(fullPath);
        const repoId = nevra ? await queryRepoId(nevra, repoIds, repoqueryCmd) : undefined;
        const repo = repoId ? repoMap.get(repoId) : undefined;

        const raw = file.replace(/\.rpm$/i, '');
        const lastDash = raw.lastIndexOf('-');
        const secondLastDash = lastDash > 0 ? raw.lastIndexOf('-', lastDash - 1) : -1;
        const splitAt = secondLastDash > 0 ? secondLastDash : lastDash;
        const name = nevra?.name || (splitAt > 0 ? raw.slice(0, splitAt) : file);
        const version = nevra ? `${nevra.version}-${nevra.release}` : (splitAt > 0 ? raw.slice(splitAt + 1) : 'unknown');

        const folder = sanitizeFolderName(repo?.folderName || repoId || 'unknown');
        const repoDir = path.join(outputByRepoRoot, folder);
        await fs.promises.mkdir(repoDir, { recursive: true });
        await fs.promises.copyFile(fullPath, path.join(repoDir, file));

        manifest.push({
            name,
            version,
            filename: file,
            size: stat.size,
            repositoryId: repoId,
            repositoryLabel: repo?.label,
            repositoryFolder: folder,
        });

        bus.emitEvent({ type: 'log', level: 'info', message: `${file} -> ${folder}` });
    }

    return manifest;
}

export async function buildRpmBundle({ specs, bundleName = 'rpm-offline', repositories, resolveDependencies = true, bus }: BuildRpmBundleOptions) {
    if (!specs.length) throw new Error('specs is required');
    const { downloadCmd, repoqueryCmd } = await resolveRpmCommands();
    bus.emitEvent({ type: 'stage', stage: 'rpm-prepare' });
    bus.emitEvent({ type: 'log', level: 'info', message: `RPMツール利用可否チェック完了: download=${downloadCmd}, repoquery=${repoqueryCmd}` });

    const repos = repositories;
    if (!repos.length) throw new Error('at least one repository must be selected');
    bus.emitEvent({ type: 'log', level: 'info', message: `有効リポジトリ: ${repos.map((r) => r.id).join(', ')}` });

    const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rpmdl-'));
    const bundleRoot = path.join(workRoot, bundleName);
    const packagesDir = path.join(bundleRoot, 'rpm', 'packages');
    const perRepoDir = path.join(bundleRoot, 'rpm', 'by-repository');
    await fs.promises.mkdir(packagesDir, { recursive: true });
    await fs.promises.mkdir(perRepoDir, { recursive: true });

    await fs.promises.writeFile(path.join(bundleRoot, 'rpm', 'specs.txt'), specs.join('\n'), 'utf8');
    await fs.promises.writeFile(path.join(bundleRoot, 'rpm', 'repositories.json'), JSON.stringify(repos, null, 2), 'utf8');

    const args: string[] = ['download', '--destdir', packagesDir, '--disablerepo=*', '--setopt=metadata_timer_sync=0', '--setopt=keepcache=0', '--setopt=best=False'];
    if (resolveDependencies) args.push('--resolve', '--alldeps');

    for (const repo of repos) {
        args.push('--repofrompath', `${repo.id},${repo.baseUrl}`);
        args.push('--setopt', `${repo.id}.gpgcheck=0`);
        args.push('--setopt', `${repo.id}.repo_gpgcheck=0`);
        args.push('--enablerepo', repo.id);
    }

    args.push(...specs);

    bus.emitEvent({ type: 'stage', stage: 'rpm-download' });
    bus.emitEvent({ type: 'log', level: 'info', message: `実行コマンド: ${downloadCmd} ${args.join(' ')}` });

    const result = await run(downloadCmd, args, {
        onStdoutLine: (line) => bus.emitEvent({ type: 'log', level: 'info', message: line }),
        onStderrLine: (line) => bus.emitEvent({ type: 'log', level: 'stderr', message: line }),
    });
    if (result.code !== 0) throw new Error(`${downloadCmd} download failed: ${result.stderr || result.stdout}`);

    const downloadedFiles = (await fs.promises.readdir(packagesDir)).filter((name) => name.toLowerCase().endsWith('.rpm')).sort();
    bus.emitEvent({ type: 'log', level: 'info', message: `ダウンロード完了: ${downloadedFiles.length} rpm` });
    bus.emitEvent({ type: 'stage', stage: 'rpm-classify-by-repository' });

    const manifest = await buildManifestAndLayout(downloadedFiles, packagesDir, perRepoDir, repos, repoqueryCmd, bus);
    bus.emitEvent({ type: 'manifest-resolved', items: manifest });

    for (let i = 0; i < manifest.length; i += 1) {
        const item = manifest[i]!;
        bus.emitEvent({ type: 'item-start', scope: 'rpm-download', index: i, digest: item.filename, total: item.size });
        bus.emitEvent({ type: 'item-progress', scope: 'rpm-download', index: i, received: item.size, total: item.size });
        bus.emitEvent({ type: 'item-done', scope: 'rpm-download', index: i });
    }

    await fs.promises.writeFile(path.join(bundleRoot, 'rpm', 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    bus.emitEvent({ type: 'tar-writing' });
    bus.emitEvent({ type: 'log', level: 'info', message: 'tarアーカイブを作成しています。' });
    const filename = `${bundleName}.tar`;
    const tarPath = path.join(workRoot, filename);
    await tar.c({ cwd: bundleRoot, file: tarPath, sync: true }, ['.']);
    bus.emitEvent({ type: 'log', level: 'info', message: `アーカイブ作成完了: ${filename}` });
    bus.emitEvent({ type: 'done', filename });

    return { tarPath, filename, workRoot, manifest };
}
