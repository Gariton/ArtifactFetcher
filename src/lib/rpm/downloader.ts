import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as tar from 'tar';
import { ProgressBus, type RpmPackage } from '@/lib/progressBus';
import { safeBundleName, safeFilenamePart } from '@/lib/inputSafety';
import { assertFileSize, assertItemCount, ByteBudget } from '@/lib/resourceLimits';

export type RpmRepoPreset = {
    id: string;
    label: string;
    folderName: string;
    baseUrl: string;
    gpgKeyUrl: string;
};

export type RpmRepository = {
    id: string;
    label: string;
    folderName: string;
    baseUrl: string;
    gpgKeyUrl: string;
    username?: string;
    password?: string;
};

export const RPM_REPO_PRESETS: RpmRepoPreset[] = [
    { id: 'centos-stream-9-baseos', label: 'CentOS Stream 9 BaseOS (official)', folderName: 'CentOS Stream BaseOS', baseUrl: 'https://mirror.stream.centos.org/9-stream/BaseOS/x86_64/os/', gpgKeyUrl: 'https://www.centos.org/keys/RPM-GPG-KEY-CentOS-Official-SHA256' },
    { id: 'centos-stream-9-appstream', label: 'CentOS Stream 9 AppStream (official)', folderName: 'CentOS Stream AppStream', baseUrl: 'https://mirror.stream.centos.org/9-stream/AppStream/x86_64/os/', gpgKeyUrl: 'https://www.centos.org/keys/RPM-GPG-KEY-CentOS-Official-SHA256' },
    { id: 'epel-9-everything', label: 'EPEL 9 Everything', folderName: 'EPEL 9', baseUrl: 'https://dl.fedoraproject.org/pub/epel/9/Everything/x86_64/', gpgKeyUrl: 'https://dl.fedoraproject.org/pub/epel/RPM-GPG-KEY-EPEL-9' },
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
    monitorDirectory?: string;
    timeoutMs?: number;
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
        let terminalError: Error | undefined;
        let monitoring = false;
        const append = (current: string, chunk: unknown) => `${current}${String(chunk)}`.slice(-1024 * 1024);
        const timeout = setTimeout(() => {
            terminalError = new Error(`${cmd} timed out`);
            child.kill('SIGKILL');
        }, opts.timeoutMs ?? 2 * 60_000);
        timeout.unref?.();
        const monitor = opts.monitorDirectory ? setInterval(() => {
            if (monitoring || terminalError) return;
            monitoring = true;
            void (async () => {
                try {
                    const names = await fs.promises.readdir(opts.monitorDirectory!);
                    assertItemCount(names.length, 'RPM download file');
                    const budget = new ByteBudget();
                    for (const name of names) {
                        const stat = await fs.promises.stat(path.join(opts.monitorDirectory!, name));
                        if (!stat.isFile()) continue;
                        assertFileSize(stat.size, `RPM package ${name}`);
                        budget.consume(stat.size);
                    }
                } catch (error) {
                    terminalError = error instanceof Error ? error : new Error('RPM download resource limit exceeded');
                    child.kill('SIGKILL');
                } finally {
                    monitoring = false;
                }
            })();
        }, 250) : undefined;
        monitor?.unref?.();

        const cleanup = () => {
            clearTimeout(timeout);
            if (monitor) clearInterval(monitor);
        };

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout = append(stdout, chunk);
            stdoutRemain = streamLines(chunk, stdoutRemain, opts.onStdoutLine);
        });
        child.stderr.on('data', (chunk) => {
            stderr = append(stderr, chunk);
            stderrRemain = streamLines(chunk, stderrRemain, opts.onStderrLine);
        });
        child.on('error', (error) => {
            cleanup();
            reject(error);
        });
        child.on('close', (code) => {
            cleanup();
            if (opts.onStdoutLine && stdoutRemain.trim()) opts.onStdoutLine(stdoutRemain.trim());
            if (opts.onStderrLine && stderrRemain.trim()) opts.onStderrLine(stderrRemain.trim());
            if (terminalError) {
                reject(terminalError);
                return;
            }
            resolve({ code: code ?? -1, stdout, stderr });
        });
    });
}

function sanitizeFolderName(name: string) {
    return safeFilenamePart(name, 'unknown');
}

export function repositoriesForArtifact(repos: RpmRepository[]) {
    return repos.map((repo) => ({
        id: repo.id,
        label: repo.label,
        folderName: repo.folderName,
        baseUrl: normalizeRpmBaseUrl(repo.baseUrl, false),
        gpgKeyUrl: repo.gpgKeyUrl,
        gpgCheck: true,
    }));
}

export function normalizeRpmBaseUrl(raw: string, hasCredentials = false): string {
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        throw new Error('RPM repository baseUrl is invalid');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('RPM repository baseUrl must use HTTP or HTTPS');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('RPM repository baseUrl must not contain credentials, a query, or a fragment');
    }
    if (hasCredentials && url.protocol !== 'https:') {
        throw new Error('RPM repository credentials require an HTTPS baseUrl');
    }
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.toString();
}

export function assertRpmSpec(spec: string): string {
    const value = spec.trim();
    const directReference = value.includes('://')
        || /^(?:file|git\+|http|https):/i.test(value)
        || value.startsWith('.')
        || value.startsWith('/')
        || value.startsWith('~')
        || value.includes('\\');
    if (!value || value.length > 512 || value.startsWith('-') || /[\0\r\n]/.test(value) || directReference) {
        throw new Error(`invalid RPM package specification: ${value || '(empty)'}`);
    }
    return value;
}

export function redactSecrets(message: string, secrets: Array<string | undefined>): string {
    return secrets
        .filter((secret): secret is string => Boolean(secret))
        .sort((a, b) => b.length - a.length)
        .reduce((redacted, secret) => redacted.split(secret).join('[REDACTED]'), message);
}

function assertSafeRepoValue(value: string, field: string) {
    if (/\r|\n/.test(value)) throw new Error(`${field} must not contain newlines`);
}

function assertPublicGpgKeyUrl(value: string, repoId: string) {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`repository ${repoId} has an invalid gpgKeyUrl`);
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error(`repository ${repoId} requires a public HTTPS gpgKeyUrl without credentials or query parameters`);
    }
}

async function prepareRpmKeyring(repos: RpmRepository[], dnfRoot: string) {
    const keyDir = path.join(dnfRoot, 'keys');
    await fs.promises.mkdir(keyDir, { recursive: true, mode: 0o700 });
    const uniqueUrls = [...new Set(repos.map((repo) => repo.gpgKeyUrl))];

    const initialized = await run('rpm', ['--root', dnfRoot, '--initdb']);
    if (initialized.code !== 0) throw new Error(`failed to initialize RPM keyring: ${initialized.stderr || initialized.stdout}`);

    for (let index = 0; index < uniqueUrls.length; index += 1) {
        const keyUrl = uniqueUrls[index]!;
        const response = await fetch(keyUrl, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`failed to download RPM GPG key (${response.status})`);
        if (new URL(response.url).protocol !== 'https:') throw new Error('RPM GPG key redirected to a non-HTTPS URL');
        const declaredSize = Number(response.headers.get('content-length') || '0');
        if (Number.isFinite(declaredSize) && declaredSize > 1024 * 1024) throw new Error('RPM GPG key exceeds 1 MiB');
        if (!response.body) throw new Error('RPM GPG key response has no body');
        const chunks: Buffer[] = [];
        let keyBytes = 0;
        const reader = response.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            keyBytes += value.byteLength;
            if (keyBytes > 1024 * 1024) {
                await reader.cancel('RPM GPG key exceeds 1 MiB');
                throw new Error('RPM GPG key exceeds 1 MiB');
            }
            chunks.push(Buffer.from(value));
        }
        const bytes = Buffer.concat(chunks);
        if (!bytes.length) throw new Error('RPM GPG key has an invalid size');
        const keyPath = path.join(keyDir, `repository-key-${index}.asc`);
        await fs.promises.writeFile(keyPath, bytes, { mode: 0o600 });
        const imported = await run('rpm', ['--root', dnfRoot, '--import', keyPath]);
        if (imported.code !== 0) throw new Error(`failed to import RPM GPG key: ${imported.stderr || imported.stdout}`);
    }
}

async function verifyRpmSignatures(files: string[], packagesDir: string, dnfRoot: string) {
    for (const file of files) {
        const result = await run('rpmkeys', ['--root', dnfRoot, '--checksig', path.join(packagesDir, file)]);
        if (result.code !== 0 || !/\bsignatures?\s+OK\b/i.test(result.stdout)) {
            throw new Error(`RPM signature verification failed for ${file}: ${result.stderr || result.stdout}`);
        }
    }
}

async function writeRepositoryConfig(repos: RpmRepository[], dnfRoot: string) {
    const repoDir = path.join(dnfRoot, 'etc', 'yum.repos.d');
    await fs.promises.mkdir(repoDir, { recursive: true, mode: 0o700 });

    for (const repo of repos) {
        if (!/^[A-Za-z0-9_.:-]+$/.test(repo.id)) throw new Error(`invalid repository id: ${repo.id}`);
        for (const [field, value] of Object.entries({
            label: repo.label,
            baseUrl: repo.baseUrl,
            gpgKeyUrl: repo.gpgKeyUrl,
            username: repo.username,
            password: repo.password,
        })) {
            if (value) assertSafeRepoValue(value, `repository ${repo.id} ${field}`);
        }
        assertPublicGpgKeyUrl(repo.gpgKeyUrl, repo.id);
        const baseUrl = normalizeRpmBaseUrl(repo.baseUrl, Boolean(repo.username || repo.password));

        const lines = [
            `[${repo.id}]`,
            `name=${repo.label || repo.id}`,
            `baseurl=${baseUrl}`,
            'enabled=1',
            'gpgcheck=1',
            'repo_gpgcheck=0',
            `gpgkey=${repo.gpgKeyUrl}`,
            'sslverify=1',
        ];
        if (repo.username) lines.push(`username=${repo.username}`);
        if (repo.password) lines.push(`password=${repo.password}`);
        await fs.promises.writeFile(path.join(repoDir, `${repo.id}.repo`), `${lines.join('\n')}\n`, { mode: 0o600 });
    }
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

async function queryRepoId(nevra: RpmNevra, repoIds: string[], repoqueryCmd: 'dnf'|'dnf5', dnfRoot: string): Promise<string | undefined> {
    const args: string[] = ['repoquery', '--quiet', '--installroot', dnfRoot, '--releasever=9', '--disablerepo=*'];
    for (const id of repoIds) args.push('--enablerepo', id);
    args.push('--qf', '%{repoid}', `${nevra.name}-${nevra.version}-${nevra.release}.${nevra.arch}`);
    const result = await run(repoqueryCmd, args).catch(() => null);
    if (!result || result.code !== 0) return undefined;
    const first = result.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first || undefined;
}

async function buildManifestAndLayout(files: string[], packagesDir: string, outputByRepoRoot: string, repos: RpmRepository[], repoqueryCmd: 'dnf'|'dnf5', dnfRoot: string, bus: ProgressBus): Promise<RpmPackage[]> {
    const repoIds = repos.map((r) => r.id);
    const repoMap = new Map(repos.map((r) => [r.id, r]));
    const manifest: RpmPackage[] = [];

    for (const file of files) {
        const fullPath = path.join(packagesDir, file);
        const stat = await fs.promises.stat(fullPath);
        const nevra = await queryNevra(fullPath);
        const repoId = nevra ? await queryRepoId(nevra, repoIds, repoqueryCmd, dnfRoot) : undefined;
        const repo = repoId ? repoMap.get(repoId) : undefined;

        // `rpm -qp` で正確な NEVRA を取得するのが基本。失敗した場合のみ、
        // 以下のファイル名分割によるベストエフォートの推定にフォールバックする
        // （末尾2つの "-" を version-release の境界とみなす簡易ヒューリスティック）。
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
    assertItemCount(specs.length, 'rpm package request');
    const safeSpecs = specs.map(assertRpmSpec);
    const resolvedBundleName = safeBundleName(bundleName, 'rpm-offline');
    const { downloadCmd, repoqueryCmd } = await resolveRpmCommands();
    bus.emitEvent({ type: 'stage', stage: 'rpm-prepare' });
    bus.emitEvent({ type: 'log', level: 'info', message: `RPMツール利用可否チェック完了: download=${downloadCmd}, repoquery=${repoqueryCmd}` });

    const repos = repositories;
    if (!repos.length) throw new Error('at least one repository must be selected');
    bus.emitEvent({ type: 'log', level: 'info', message: `有効リポジトリ: ${repos.map((r) => r.id).join(', ')}` });

    const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rpmdl-'));
    try {
        const bundleRoot = path.join(workRoot, resolvedBundleName);
        const packagesDir = path.join(bundleRoot, 'rpm', 'packages');
        const perRepoDir = path.join(bundleRoot, 'rpm', 'by-repository');
        const dnfRoot = path.join(workRoot, 'dnf-root');
        await fs.promises.mkdir(packagesDir, { recursive: true });
        await fs.promises.mkdir(perRepoDir, { recursive: true });
        await writeRepositoryConfig(repos, dnfRoot);
        await prepareRpmKeyring(repos, dnfRoot);

        await fs.promises.writeFile(path.join(bundleRoot, 'rpm', 'specs.txt'), safeSpecs.join('\n'), 'utf8');
        // Credentials are runtime-only and must never be copied into the downloadable artifact.
        const artifactRepositories = repositoriesForArtifact(repos);
        await fs.promises.writeFile(path.join(bundleRoot, 'rpm', 'repositories.json'), JSON.stringify(artifactRepositories, null, 2), 'utf8');

        const args: string[] = ['download', '--assumeyes', '--installroot', dnfRoot, '--releasever=9', '--destdir', packagesDir, '--disablerepo=*', '--setopt=metadata_timer_sync=0', '--setopt=keepcache=0', '--setopt=best=False'];
        if (resolveDependencies) args.push('--resolve', '--alldeps');

        for (const repo of repos) {
            args.push('--enablerepo', repo.id);
        }

        // End option parsing before user-controlled package specifications.
        args.push('--', ...safeSpecs);

        bus.emitEvent({ type: 'stage', stage: 'rpm-download' });
        bus.emitEvent({ type: 'log', level: 'info', message: `実行コマンド: ${downloadCmd} ${args.join(' ')}` });

        const secrets = repos.flatMap((repo) => [repo.username, repo.password]);
        const result = await run(downloadCmd, args, {
            monitorDirectory: packagesDir,
            timeoutMs: 10 * 60_000,
            onStdoutLine: (line) => bus.emitEvent({ type: 'log', level: 'info', message: redactSecrets(line, secrets) }),
            onStderrLine: (line) => bus.emitEvent({ type: 'log', level: 'stderr', message: redactSecrets(line, secrets) }),
        });
        if (result.code !== 0) throw new Error(`${downloadCmd} download failed: ${redactSecrets(result.stderr || result.stdout, secrets)}`);

        const downloadedFiles = (await fs.promises.readdir(packagesDir)).filter((name) => name.toLowerCase().endsWith('.rpm')).sort();
        if (!downloadedFiles.length) throw new Error('dnf did not download any RPM packages');
        bus.emitEvent({ type: 'stage', stage: 'rpm-verify-signatures' });
        await verifyRpmSignatures(downloadedFiles, packagesDir, dnfRoot);
        bus.emitEvent({ type: 'log', level: 'info', message: `GPG署名検証完了: ${downloadedFiles.length} rpm` });
        assertItemCount(downloadedFiles.length, 'rpm package');
        const budget = new ByteBudget();
        for (const file of downloadedFiles) {
            const size = (await fs.promises.stat(path.join(packagesDir, file))).size;
            assertFileSize(size, `rpm package ${file}`);
            // The bundle contains both packages/ and the by-repository layout.
            budget.consume(size * 2);
        }
        bus.emitEvent({ type: 'log', level: 'info', message: `ダウンロード完了: ${downloadedFiles.length} rpm` });
        bus.emitEvent({ type: 'stage', stage: 'rpm-classify-by-repository' });

        const manifest = await buildManifestAndLayout(downloadedFiles, packagesDir, perRepoDir, repos, repoqueryCmd, dnfRoot, bus);
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
        const filename = `${resolvedBundleName}.tar`;
        const tarPath = path.join(workRoot, filename);
        await tar.c({ cwd: bundleRoot, file: tarPath }, ['.']);
        bus.emitEvent({ type: 'log', level: 'info', message: `アーカイブ作成完了: ${filename}` });

        return { tarPath, filename, workRoot, manifest };
    } catch (error) {
        try { await fs.promises.rm(workRoot, { recursive: true, force: true }); } catch {}
        throw error;
    }
}
