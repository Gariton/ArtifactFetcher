import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as tar from 'tar';

export type NpmPublishOptions = {
    tarballPath: string;
    registry: string;
    authToken?: string;
    username?: string;
    password?: string;
};

function buildNpmRc({ registry, authToken, username, password }: { registry: string; authToken?: string; username?: string; password?: string }) {
    const url = new URL(registry);
    const pathSegment = url.pathname.replace(/\/$/, '');
    const hostAndPath = pathSegment ? `${url.host}${pathSegment}` : url.host;
    const strictSsl = /^(1|true|on|yes)$/i.test(process.env.NPM_UPLOAD_STRICT_SSL || '');
    const lines = [
        `registry=${registry}`,
        `always-auth=true`,
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
    await tar.t({
        file: tarballPath,
        onentry(entry) {
            const normalized = entry.path.replace(/^\.\//, '').replace(/\/+/g, '/');
            if (entry.type === 'File' && manifestDepth(normalized) !== null) {
                const chunks: Buffer[] = [];
                candidates.set(normalized, chunks);
                // マルチバイト文字がチャンク境界で分割されても壊れないよう Buffer のまま蓄積する。
                entry.on('data', (chunk: Buffer | string) => {
                    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
                });
            } else {
                entry.resume();
            }
        },
    });
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
    return { name: parsed.name, version: parsed.version };
}

type SpawnResult = {
    code: number;
    stdout: string;
    stderr: string;
};

async function runNpmCommand(args: string[], env: NodeJS.ProcessEnv, { forwardOutput = false }: { forwardOutput?: boolean } = {}): Promise<SpawnResult> {
    return await new Promise<SpawnResult>((resolve, reject) => {
        const child = spawn('npm', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            stdout += text;
            if (forwardOutput) process.stdout.write(chunk);
        });
        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            if (forwardOutput) process.stderr.write(chunk);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            resolve({ code: code ?? -1, stdout, stderr });
        });
    });
}

export async function publishTarball({ tarballPath, registry, authToken, username, password }: NpmPublishOptions) {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'npm-publish-'));
    const npmrcPath = path.join(workDir, '.npmrc');
    try {
        const manifest = await readTarballManifest(tarballPath);
        const packageId = `${manifest.name}@${manifest.version}`;
        await fs.writeFile(npmrcPath, buildNpmRc({ registry, authToken, username, password }), 'utf8');
        const env = {
            ...process.env,
            npm_config_userconfig: npmrcPath,
            NPM_CONFIG_USERCONFIG: npmrcPath,
        } as NodeJS.ProcessEnv;
        const viewResult = await runNpmCommand(['view', packageId, 'version', '--registry', registry, '--json'], env);
        const versionExists = viewResult.code === 0;
        if (!versionExists && viewResult.code !== 0) {
            const combined = `${viewResult.stdout}\n${viewResult.stderr}`.toLowerCase();
            if (combined.trim() && !combined.includes('e404')) {
                console.warn(`[npm publish] Failed to check existing version for ${packageId}: ${combined.trim()}`);
            }
        }

        if (versionExists) {
            console.log(`[npm publish] ${packageId} already exists; attempting to unpublish before redeploy.`);
            const unpublishResult = await runNpmCommand(['unpublish', packageId, '--registry', registry, '--force'], env, { forwardOutput: true });
            if (unpublishResult.code !== 0) {
                const details = (unpublishResult.stderr || unpublishResult.stdout || '').trim();
                throw new Error(`npm unpublish failed for ${packageId}${details ? `: ${details}` : ''}`);
            }
        }

        const publishResult = await runNpmCommand(['publish', tarballPath, '--registry', registry], env, { forwardOutput: true });
        if (publishResult.code !== 0) {
            const details = (publishResult.stderr || publishResult.stdout || '').trim();
            throw new Error(`npm publish failed for ${packageId}${details ? `: ${details}` : ''}`);
        }
    } finally {
        try { await fs.rm(workDir, { recursive: true, force: true }); } catch {}
    }
}
