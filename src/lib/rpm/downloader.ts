import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as tar from 'tar';
import { ProgressBus, type RpmPackage } from '@/lib/progressBus';

export type RpmRepoPreset = {
    id: string;
    label: string;
    baseUrl: string;
};

export const RPM_REPO_PRESETS: RpmRepoPreset[] = [
    { id: 'centos-stream-9-baseos', label: 'CentOS Stream 9 BaseOS (official)', baseUrl: 'https://mirror.stream.centos.org/9-stream/BaseOS/x86_64/os/' },
    { id: 'centos-stream-9-appstream', label: 'CentOS Stream 9 AppStream (official)', baseUrl: 'https://mirror.stream.centos.org/9-stream/AppStream/x86_64/os/' },
    { id: 'epel-9-everything', label: 'EPEL 9 Everything', baseUrl: 'https://dl.fedoraproject.org/pub/epel/9/Everything/x86_64/' },
];

type BuildRpmBundleOptions = {
    specs: string[];
    bundleName?: string;
    selectedRepos: string[];
    resolveDependencies?: boolean;
    bus: ProgressBus;
};

function run(cmd: string, args: string[]) {
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
}

async function ensureDnfAvailable() {
    const check = await run('dnf', ['--version']).catch(() => null);
    if (!check || check.code !== 0) throw new Error('dnf command is required for rpm download. Please install dnf + dnf-plugins-core.');
    const hasDownload = await run('dnf', ['download', '--help']).catch(() => null);
    if (!hasDownload || hasDownload.code !== 0) throw new Error('dnf download command is required. Please install dnf-plugins-core.');
}

function buildManifest(files: string[], packagesDir: string): Promise<RpmPackage[]> {
    return Promise.all(files.map(async (file) => {
        const fullPath = path.join(packagesDir, file);
        const stat = await fs.promises.stat(fullPath);
        const raw = file.replace(/\.rpm$/i, '');
        const lastDash = raw.lastIndexOf('-');
        const secondLastDash = lastDash > 0 ? raw.lastIndexOf('-', lastDash - 1) : -1;
        const splitAt = secondLastDash > 0 ? secondLastDash : lastDash;
        const name = splitAt > 0 ? raw.slice(0, splitAt) : file;
        const version = splitAt > 0 ? raw.slice(splitAt + 1) : 'unknown';
        return {
            name,
            version,
            filename: file,
            size: stat.size,
        } satisfies RpmPackage;
    }));
}

export async function buildRpmBundle({ specs, bundleName = 'rpm-offline', selectedRepos, resolveDependencies = true, bus }: BuildRpmBundleOptions) {
    if (!specs.length) throw new Error('specs is required');
    await ensureDnfAvailable();
    bus.emitEvent({ type: 'stage', stage: 'rpm-prepare' });

    const repos = RPM_REPO_PRESETS.filter((repo) => selectedRepos.includes(repo.id));
    if (!repos.length) throw new Error('at least one repository must be selected');

    const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rpmdl-'));
    const bundleRoot = path.join(workRoot, bundleName);
    const packagesDir = path.join(bundleRoot, 'rpm', 'packages');
    await fs.promises.mkdir(packagesDir, { recursive: true });

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
    const result = await run('dnf', args);
    if (result.code !== 0) throw new Error(`dnf download failed: ${result.stderr || result.stdout}`);

    const downloadedFiles = (await fs.promises.readdir(packagesDir)).filter((name) => name.toLowerCase().endsWith('.rpm')).sort();
    const manifest = await buildManifest(downloadedFiles, packagesDir);
    bus.emitEvent({ type: 'manifest-resolved', items: manifest });

    for (let i = 0; i < manifest.length; i += 1) {
        const item = manifest[i]!;
        bus.emitEvent({ type: 'item-start', scope: 'rpm-download', index: i, digest: item.filename, total: item.size });
        bus.emitEvent({ type: 'item-progress', scope: 'rpm-download', index: i, received: item.size, total: item.size });
        bus.emitEvent({ type: 'item-done', scope: 'rpm-download', index: i });
    }

    await fs.promises.writeFile(path.join(bundleRoot, 'rpm', 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    bus.emitEvent({ type: 'tar-writing' });
    const filename = `${bundleName}.tar`;
    const tarPath = path.join(workRoot, filename);
    await tar.c({ cwd: bundleRoot, file: tarPath, sync: true }, ['.']);
    bus.emitEvent({ type: 'done', filename });

    return { tarPath, filename, workRoot, manifest };
}
