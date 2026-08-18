import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as tar from 'tar';

export type NpmPublishOptions = {
    tarballPath: string;
    registry: string;
    authToken?: string;
    username?: string;
    password?: string;
};

export type NpmPublishResult = {
    packageId: string;
    status: 'published' | 'skipped';
};

export function normalizeNpmRegistryUrl(registry: string, hasCredentials = false): string {
    const url = new URL(registry);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('npm registry URL must use HTTP or HTTPS');
    }
    if (url.username || url.password) {
        throw new Error('npm registry credentials must be supplied separately from the URL');
    }
    if (hasCredentials && url.protocol !== 'https:') {
        throw new Error('npm registry credentials require an HTTPS URL');
    }
    if (url.search || url.hash) {
        throw new Error('npm registry URL must not contain a query string or fragment');
    }
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.toString();
}

function buildNpmRc({ registry, authToken, username, password }: { registry: string; authToken?: string; username?: string; password?: string }) {
    const url = new URL(registry);
    const pathSegment = url.pathname.replace(/\/$/, '');
    const hostAndPath = pathSegment ? `${url.host}${pathSegment}` : url.host;
    const strictSsl = !/^(0|false|off|no)$/i.test(process.env.NPM_UPLOAD_STRICT_SSL || '');
    const lines = [
        `registry=${registry}`,
    ];
    if (!strictSsl || url.protocol === 'http:') {
        lines.push('strict-ssl=false');
    }
    if (authToken) {
        lines.push(`//${hostAndPath}/:_authToken=${authToken}`);
    } else if (username && password) {
        const encoded = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
        lines.push(`//${hostAndPath}/:_auth=${encoded}`);
    }
    // 認証情報を含むため .npmrc の内容はログに出力しない。
    return lines.join('\n') + '\n';
}

type PackageManifest = {
    name: string;
    version: string;
};

// npm 標準の tarball はルートが `package/` だが、ミラーや別レジストリが再パックした
// tarball ではルートディレクトリ名が異なったり `./` 接頭辞が付くことがある。
// そのため固定パス一致ではなく、最も浅い階層にある package.json を採用する。
function manifestDepth(normalizedPath: string): number | null {
    const segments = normalizedPath.split('/');
    // `<root>/package.json` の形（深さ2）だけをパッケージ manifest とみなす。
    if (segments.length === 2 && segments[1] === 'package.json') {
        return segments.length;
    }
    return null;
}

async function readTarballManifest(tarballPath: string): Promise<PackageManifest> {
    const candidates = new Map<string, Buffer[]>();
    const candidateSizes = new Map<string, number>();
    let validationError: Error | undefined;
    await tar.t({
        file: tarballPath,
        onentry(entry) {
            const normalized = entry.path.replace(/^\.\//, '').replace(/\/+/g, '/');
            if (entry.type === 'File' && manifestDepth(normalized) !== null) {
                if (entry.size > 1024 * 1024) {
                    validationError = new Error('package.json in tarball exceeds 1 MiB');
                    entry.resume();
                    return;
                }
                const chunks: Buffer[] = [];
                candidates.set(normalized, chunks);
                candidateSizes.set(normalized, 0);
                // マルチバイト文字がチャンク境界で分割されても壊れないよう Buffer のまま蓄積する。
                entry.on('data', (chunk: Buffer | string) => {
                    if (validationError) return;
                    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
                    const total = (candidateSizes.get(normalized) || 0) + bytes.length;
                    if (total > 1024 * 1024) {
                        validationError = new Error('package.json in tarball exceeds 1 MiB');
                        return;
                    }
                    candidateSizes.set(normalized, total);
                    chunks.push(bytes);
                });
            } else {
                entry.resume();
            }
        },
    });
    if (validationError) throw validationError;
    // 複数候補がある場合は `package/package.json` を優先し、なければ任意の1件を使う。
    const chosenKey = candidates.has('package/package.json')
        ? 'package/package.json'
        : candidates.keys().next().value;
    const chunks = chosenKey ? candidates.get(chosenKey) : undefined;
    const manifestRaw = chunks && chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
    if (!manifestRaw) {
        throw new Error('package.json not found in tarball');
    }
    let parsed: any;
    try {
        parsed = JSON.parse(manifestRaw);
    } catch (err) {
        throw new Error(`failed to parse package.json from tarball: ${(err as Error).message}`);
    }
    if (!parsed?.name || !parsed?.version) {
        throw new Error('package manifest missing name or version');
    }
    if (!isSafePackageName(parsed.name) || !isSafePackageVersion(parsed.version)) {
        throw new Error('package manifest contains an invalid name or version');
    }
    return { name: parsed.name, version: parsed.version };
}

function isSafePackageName(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 214) return false;
    const segment = '[a-z0-9][a-z0-9._~-]*';
    return new RegExp(`^(?:${segment}|@${segment}/${segment})$`).test(value);
}

function isSafePackageVersion(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= 256
        && !value.startsWith('-')
        && !/[\0\r\n\s/]/.test(value);
}

type SpawnResult = {
    code: number;
    stdout: string;
    stderr: string;
};

function positiveTimeout(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const NPM_VIEW_TIMEOUT_MS = positiveTimeout('NPM_VIEW_TIMEOUT_MS', 2 * 60_000);
const NPM_PUBLISH_TIMEOUT_MS = positiveTimeout('NPM_PUBLISH_TIMEOUT_MS', 2 * 60 * 60_000);

async function runNpmCommand(args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<SpawnResult> {
    return await new Promise<SpawnResult>((resolve, reject) => {
        const child = spawn('npm', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const append = (current: string, chunk: unknown) => `${current}${String(chunk)}`.slice(-1024 * 1024);
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, timeoutMs);
        child.stdout.on('data', (chunk) => {
            stdout = append(stdout, chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderr = append(stderr, chunk);
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code: timedOut ? -1 : (code ?? -1), stdout, stderr: timedOut ? `${stderr}\nnpm command timed out` : stderr });
        });
    });
}

function redactCommandOutput(output: string, { authToken, username, password }: Pick<NpmPublishOptions, 'authToken' | 'username' | 'password'>): string {
    let redacted = output;
    const encodedBasicAuth = username && password
        ? Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
        : undefined;
    const secrets = [authToken, username, password, encodedBasicAuth]
        .filter((secret): secret is string => Boolean(secret));
    for (const secret of secrets) {
        redacted = redacted.split(secret).join('[REDACTED]');
    }
    return redacted
        .replace(/((?:^|\n)\s*(?:\/\/[^\s=]+:)?_auth(?:Token)?\s*=\s*)[^\s]+/gi, '$1[REDACTED]')
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
        .trim();
}

function commandFailureDetails(result: SpawnResult, options: Pick<NpmPublishOptions, 'authToken' | 'username' | 'password'>): string {
    return redactCommandOutput(result.stderr || result.stdout || '', options);
}

function isNotFound(result: SpawnResult): boolean {
    const output = `${result.stdout}\n${result.stderr}`;
    return /(?:^|\W)E404(?:\W|$)/i.test(output)
        || /(?:^|\W)404(?:\W|$).*(?:not[ -]?found)/i.test(output)
        || /(?:not[ -]?found).*(?:^|\W)404(?:\W|$)/i.test(output);
}

type TarballDigests = { integrity: string; shasum: string };

async function tarballDigests(filePath: string): Promise<TarballDigests> {
    const sha512 = crypto.createHash('sha512');
    const sha1 = crypto.createHash('sha1');
    for await (const chunk of createReadStream(filePath)) {
        sha512.update(chunk);
        sha1.update(chunk);
    }
    return {
        integrity: `sha512-${sha512.digest('base64')}`,
        shasum: sha1.digest('hex'),
    };
}

async function checkVersion(
    packageId: string,
    registry: string,
    env: NodeJS.ProcessEnv,
    options: Pick<NpmPublishOptions, 'authToken' | 'username' | 'password'>,
    local: TarballDigests,
): Promise<'missing' | 'matching'> {
    const result = await runNpmCommand([
        'view', packageId, 'dist', '--registry', registry, '--json', '--loglevel=error',
    ], env, NPM_VIEW_TIMEOUT_MS);
    if (result.code === 0) {
        let dist: { integrity?: string; shasum?: string };
        try {
            dist = JSON.parse(result.stdout.trim());
        } catch {
            throw new Error(`npm registry returned invalid metadata while checking ${packageId}`);
        }
        const matches = dist.integrity
            ? dist.integrity === local.integrity
            : Boolean(dist.shasum && dist.shasum.toLowerCase() === local.shasum);
        if (matches) return 'matching';
        throw new Error(`${packageId} already exists with different package content`);
    }
    if (isNotFound(result)) return 'missing';

    const details = commandFailureDetails(result, options);
    throw new Error(`npm registry check failed for ${packageId}${details ? `: ${details}` : ''}`);
}

export async function publishTarball({ tarballPath, registry, authToken, username, password }: NpmPublishOptions): Promise<NpmPublishResult> {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'npm-publish-'));
    const npmrcPath = path.join(workDir, '.npmrc');
    try {
        const normalizedRegistry = normalizeNpmRegistryUrl(registry, Boolean(authToken || username || password));
        const manifest = await readTarballManifest(tarballPath);
        const packageId = `${manifest.name}@${manifest.version}`;
        const digests = await tarballDigests(tarballPath);
        await fs.writeFile(npmrcPath, buildNpmRc({ registry: normalizedRegistry, authToken, username, password }), {
            encoding: 'utf8',
            mode: 0o600,
        });
        const env = {
            ...process.env,
            npm_config_userconfig: npmrcPath,
            NPM_CONFIG_USERCONFIG: npmrcPath,
        } as NodeJS.ProcessEnv;
        const credentials = { authToken, username, password };
        if (await checkVersion(packageId, normalizedRegistry, env, credentials, digests) === 'matching') {
            // Published npm versions are immutable. Never unpublish/redeploy here: on Nexus this can
            // remove repository content while Disable redeploy then prevents putting it back.
            return { packageId, status: 'skipped' };
        }

        const publishResult = await runNpmCommand([
            'publish', tarballPath, '--registry', normalizedRegistry, '--loglevel=error',
        ], env, NPM_PUBLISH_TIMEOUT_MS);
        if (publishResult.code !== 0) {
            // Close the check/publish race idempotently: if another publisher won, preserve its
            // version and report this upload as skipped instead of trying to overwrite/delete it.
            try {
                if (await checkVersion(packageId, normalizedRegistry, env, credentials, digests) === 'matching') {
                    return { packageId, status: 'skipped' };
                }
            } catch {
                // Preserve the original publish failure, which is the actionable error for callers.
            }
            const details = commandFailureDetails(publishResult, credentials);
            throw new Error(`npm publish failed for ${packageId}${details ? `: ${details}` : ''}`);
        }
        return { packageId, status: 'published' };
    } finally {
        try { await fs.rm(workDir, { recursive: true, force: true }); } catch {}
    }
}
