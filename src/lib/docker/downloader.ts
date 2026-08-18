import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import { ProgressBus } from "../progressBus";
import { assertDockerRepository, assertDockerTag, safeFilenamePart } from '@/lib/inputSafety';
import { assertFileSize, assertItemCount, ByteBudget } from '@/lib/resourceLimits';

const MEDIA = {
    INDEX: 'application/vnd.oci.image.index.v1+json',
    MANIFEST_LIST: 'application/vnd.docker.distribution.manifest.list.v2+json',
    MANIFEST_OCI: 'application/vnd.oci.image.manifest.v1+json',
    MANIFEST_DOCKER: 'application/vnd.docker.distribution.manifest.v2+json',
};

// Docker Hub の実体ホスト。`docker.io` 等のエイリアスはここへ正規化する。
const DOCKER_HUB_REGISTRY = 'registry-1.docker.io';

export type RegistryAuth = {
    username?: string;
    password?: string;
};

type RegistryTarget = {
    host: string;        // 表示・タグ用のホスト名（例: docker.io, ghcr.io）
    baseUrl: string;     // API ベース URL（例: https://registry-1.docker.io）
    isDockerHub: boolean;
};

// 取得した Bearer/Basic の Authorization ヘッダを呼び出し間で共有する。
type TokenRef = { value?: string };

async function requestWithRetry(config: any, retries = 5, baseDelayMs = 500) {
    let attempt = 0;
    while (true) {
        try {
            return await axios.request({ timeout: 60_000, ...config });
        } catch (err: any) {
            attempt += 1;
            const status = err?.response?.status;
            const retriable = err?.code === 'ECONNABORTED' || err?.code === 'ECONNRESET' || status === 429 || (status >= 500 && status < 600);
            if (!retriable || attempt > retries) throw err;
            const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}

function makeHttpsAgent(insecure?: boolean) {
    return insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined;
}

function buildBasicAuth(auth?: RegistryAuth): string | undefined {
    if (!auth?.username) return undefined;
    const encoded = Buffer.from(`${auth.username}:${auth.password ?? ''}`, 'utf8').toString('base64');
    return `Basic ${encoded}`;
}

/** `WWW-Authenticate` ヘッダを { scheme, realm, service, scope } へパースする。 */
function parseWwwAuthenticate(header: string): { scheme: string; realm?: string; service?: string; scope?: string } {
    const trimmed = header.trim();
    const spaceIdx = trimmed.indexOf(' ');
    const scheme = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
    const params: Record<string, string> = {};
    const re = /(\w+)="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest)) !== null) {
        params[m[1]] = m[2];
    }
    return { scheme, realm: params.realm, service: params.service, scope: params.scope };
}

/** 401 チャレンジに従って Authorization ヘッダ値を取得する（Bearer トークン or Basic）。 */
async function negotiateAuth(
    challenge: { scheme: string; realm?: string; service?: string; scope?: string },
    auth: RegistryAuth | undefined,
    insecure: boolean | undefined,
): Promise<string | undefined> {
    // トークンサービスを持たないレジストリ（Basic 認証直）への対応。
    if (!challenge.scheme || /^basic$/i.test(challenge.scheme) || !challenge.realm) {
        const basic = buildBasicAuth(auth);
        if (!basic) throw new Error('Registry requires authentication but no credentials were provided.');
        return basic;
    }

    const url = new URL(challenge.realm);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Registry authentication realm must be an HTTP(S) URL without credentials');
    }
    if (challenge.service) url.searchParams.set('service', challenge.service);
    if (challenge.scope) url.searchParams.set('scope', challenge.scope);

    const headers: Record<string, string> = {};
    const basic = buildBasicAuth(auth);
    if (basic && url.protocol !== 'https:') {
        throw new Error('Registry credentials require an HTTPS authentication realm');
    }
    if (basic) headers.Authorization = basic; // 認証付きトークン取得

    const res = await requestWithRetry({
        method: 'GET',
        url: url.toString(),
        headers,
        maxRedirects: basic ? 0 : 5,
        httpsAgent: makeHttpsAgent(insecure),
        validateStatus: (s: number) => s >= 200 && s < 500,
    });
    if (res.status >= 400) {
        throw new Error(`Token authentication failed (${res.status}) at ${challenge.realm}`);
    }
    const token = res.data?.token || res.data?.access_token;
    if (!token) throw new Error('Authentication response did not contain a token.');
    return `Bearer ${token}`;
}

/** v2 API への GET。401 を受けたら一度だけチャレンジに従って認証し再試行する。 */
async function registryGet(opts: {
    baseUrl: string;
    apiPath: string;
    auth?: RegistryAuth;
    accept?: string;
    responseType?: 'json' | 'stream';
    insecure?: boolean;
    tokenRef: TokenRef;
}) {
    const { baseUrl, apiPath, auth, accept, responseType, insecure, tokenRef } = opts;
    const url = `${baseUrl}${apiPath}`;
    const httpsAgent = makeHttpsAgent(insecure);
    const buildHeaders = () => {
        const h: Record<string, string> = {};
        if (accept) h.Accept = accept;
        if (tokenRef.value) h.Authorization = tokenRef.value;
        return h;
    };
    const base = {
        method: 'GET' as const,
        url,
        responseType,
        httpsAgent,
        validateStatus: (s: number) => s >= 200 && s < 500,
    };

    let res = await requestWithRetry({ ...base, headers: buildHeaders() });
    if (res.status === 401) {
        const challenge = parseWwwAuthenticate(String(res.headers['www-authenticate'] || ''));
        tokenRef.value = await negotiateAuth(challenge, auth, insecure);
        res = await requestWithRetry({ ...base, headers: buildHeaders() });
    }
    if (res.status >= 400) {
        throw new Error(`Registry request failed (${res.status}) for ${apiPath}`);
    }
    return res;
}

/** レジストリ入力（任意・スキーム/エイリアス込み可）を API ベース URL 等へ正規化する。 */
function normalizeRegistry(input?: string): RegistryTarget {
    const reg = (input || '').trim();
    if (!reg) {
        return { host: 'docker.io', baseUrl: `https://${DOCKER_HUB_REGISTRY}`, isDockerHub: true };
    }
    let url: URL;
    try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(reg) ? reg : `https://${reg}`); }
    catch { throw new Error('Docker registry URL is invalid'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('Docker registry URL must be HTTP(S) without credentials, query, or fragment');
    }
    url.pathname = url.pathname.replace(/\/+$/, '');
    if (['docker.io', 'index.docker.io', 'registry-1.docker.io'].includes(url.hostname) && !url.pathname) {
        return { host: 'docker.io', baseUrl: `https://${DOCKER_HUB_REGISTRY}`, isDockerHub: true };
    }
    return { host: url.host, baseUrl: url.toString().replace(/\/$/, ''), isDockerHub: false };
}

/**
 * レジストリと repository を解決する。`registryInput` が空の場合は repository の
 * 先頭セグメントがレジストリホスト（"." や ":" を含む、または "localhost"）かどうかで判定する。
 * Docker Hub の公式イメージ（スラッシュ無し）には `library/` を補う。
 */
function resolveTarget(registryInput: string | undefined, repoInput: string): { target: RegistryTarget; repository: string } {
    let repo = repoInput.trim().replace(/^https?:\/\//i, '');
    let regInput = registryInput?.trim();

    if (!regInput) {
        const slash = repo.indexOf('/');
        const first = slash === -1 ? '' : repo.slice(0, slash);
        if (first && (first.includes('.') || first.includes(':') || first === 'localhost')) {
            regInput = first;
            repo = repo.slice(slash + 1);
        }
    }

    const target = normalizeRegistry(regInput);
    if (target.isDockerHub && !repo.includes('/')) {
        repo = `library/${repo}`;
    }
    return { target, repository: repo };
}

async function resolvePlatformManifest(
    baseUrl: string,
    repository: string,
    tag: string,
    platform: string,
    auth: RegistryAuth | undefined,
    insecure: boolean | undefined,
    tokenRef: TokenRef,
    bus: ProgressBus,
) {
    bus.emitEvent({ type: "stage", stage: "resolve-manifest" });
    const accept = [MEDIA.INDEX, MEDIA.MANIFEST_LIST, MEDIA.MANIFEST_OCI, MEDIA.MANIFEST_DOCKER].join(', ');
    const res = await registryGet({ baseUrl, apiPath: `/v2/${repository}/manifests/${tag}`, auth, accept, responseType: 'json', insecure, tokenRef });
    const data = res.data;
    const mediaType = (res.headers['content-type'] as string)?.split(';')[0] || '';

    if (mediaType === MEDIA.INDEX || mediaType === MEDIA.MANIFEST_LIST || (data as any).manifests) {
        const [osName, arch] = platform.split('/');
        const match = (data as any).manifests.find((m: any) => m.platform?.os === osName && m.platform?.architecture === arch);
        if (!match) throw new Error(`No manifest found for platform ${platform}`);
        const acc = [MEDIA.MANIFEST_OCI, MEDIA.MANIFEST_DOCKER].join(', ');
        const sub = await registryGet({ baseUrl, apiPath: `/v2/${repository}/manifests/${match.digest}`, auth, accept: acc, responseType: 'json', insecure, tokenRef });
        return sub.data;
    }
    return data; // already single-platform
}

async function downloadBlob(
    baseUrl: string,
    repository: string,
    digest: string,
    auth: RegistryAuth | undefined,
    insecure: boolean | undefined,
    tokenRef: TokenRef,
    destFile: string,
    bus: ProgressBus,
    index?: number,
    budget?: ByteBudget,
) {
    const res = await registryGet({ baseUrl, apiPath: `/v2/${repository}/blobs/${digest}`, auth, responseType: 'stream', insecure, tokenRef });
    const total = Number.parseInt(String(res.headers['content-length'] ?? '0'), 10);
    assertFileSize(total || undefined, `Docker blob ${digest}`);
    if (typeof index === 'number') bus.emitEvent({ type: 'item-start', index, digest, total: total || undefined });

    await fs.promises.mkdir(path.dirname(destFile), { recursive: true });
    const hash = crypto.createHash('sha256');
    let received = 0;
    const limiter = new Transform({
        transform(chunk: Buffer | string, _encoding, callback) {
            const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
            try {
                received += bytes;
                assertFileSize(received, `Docker blob ${digest}`);
                budget?.consume(bytes);
                hash.update(chunk);
                if (typeof index === 'number') bus.emitEvent({ type: 'item-progress', index, received, total: total || undefined });
                callback(null, chunk);
            } catch (error) {
                callback(error as Error);
            }
        },
    });
    await pipeline(res.data, limiter, fs.createWriteStream(destFile));

    const computed = `sha256:${hash.digest('hex')}`;
    if (computed !== digest) {
        throw new Error(`Digest mismatch for ${destFile}. expected=${digest} got=${computed}`);
    }
    if (typeof index === 'number') bus.emitEvent({ type: 'item-done', index });
}

/**
* Build a docker-load compatible tar and return the tar absolute path.
* registry を省略すると Docker Hub から取得する。任意のレジストリ（ghcr.io,
* quay.io, 社内レジストリ等）と Basic/Bearer 認証、TLS 検証スキップに対応する。
*/
export async function buildDockerImageTar({
    repository,
    tag,
    platform = 'linux/amd64',
    registry,
    username,
    password,
    insecureTLS,
    bus,
}: {
    repository: string;
    tag: string;
    platform?: string;
    registry?: string;
    username?: string;
    password?: string;
    insecureTLS?: boolean;
    bus: ProgressBus;
}): Promise<{ tarPath: string; filename: string; workRoot: string }> {
    const normalizedTag = assertDockerTag(tag);
    const { target, repository: resolvedRepository } = resolveTarget(registry, repository);
    const repo = assertDockerRepository(resolvedRepository);
    const auth: RegistryAuth | undefined = username ? { username, password } : undefined;
    if (auth && new URL(target.baseUrl).protocol !== 'https:') {
        throw new Error('Docker registry credentials require an HTTPS registry URL');
    }
    const tokenRef: TokenRef = {};

    bus.emitEvent({ type: 'stage', stage: 'auth' });
    bus.emitEvent({ type: 'log', level: 'info', message: `レジストリ: ${target.host} / イメージ: ${repo}:${normalizedTag}` });

    const manifest: any = await resolvePlatformManifest(target.baseUrl, repo, normalizedTag, platform, auth, insecureTLS, tokenRef, bus);
    if (!manifest?.config?.digest || !Array.isArray(manifest.layers)) {
        throw new Error('Unexpected manifest structure (missing config or layers).');
    }
    assertItemCount(manifest.layers.length, 'Docker layer');
    bus.emitEvent({ type: 'manifest-resolved', items: manifest.layers });

    const safeRepo = safeFilenamePart(repo.replaceAll('/', '_'), 'image');
    const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imgdl-'));
    try {
        const imageDir = path.join(workRoot, `${safeRepo}@${normalizedTag}`);
        await fs.promises.mkdir(imageDir, { recursive: true });
        const budget = new ByteBudget();
        const parseDigest = (digest: unknown) => {
            const match = /^sha256:([a-f0-9]{64})$/i.exec(String(digest ?? ''));
            if (!match) throw new Error(`unsupported or invalid Docker digest: ${digest}`);
            return match[1].toLowerCase();
        };

        bus.emitEvent({ type: 'stage', stage: 'download-config' });
        const configDigest = parseDigest(manifest.config.digest);
        const configPath = path.join(imageDir, `${configDigest}.json`);
        await downloadBlob(target.baseUrl, repo, manifest.config.digest, auth, insecureTLS, tokenRef, configPath, bus, undefined, budget);

        for (let i = 0; i < manifest.layers.length; i++) {
            bus.emitEvent({ type: 'stage', stage: `download-layer-${i}` });
            const layer = manifest.layers[i];
            const layerId = parseDigest(layer.digest);
            const layerDir = path.join(imageDir, layerId);
            const dest = path.join(layerDir, 'layer.tar');
            await downloadBlob(target.baseUrl, repo, layer.digest, auth, insecureTLS, tokenRef, dest, bus, i, budget);
        }

        // docker load 後に正しいタグが付くよう、Docker Hub 以外はホスト名を前置する。
        const refName = target.isDockerHub ? repo : `${target.host}/${repo}`;
        const loadManifest = [
            {
                Config: `${configDigest}.json`,
                RepoTags: [`${refName}:${normalizedTag}`],
                Layers: manifest.layers.map((l: any) => `${parseDigest(l.digest)}/layer.tar`),
            },
        ];
        await fs.promises.writeFile(path.join(imageDir, 'manifest.json'), JSON.stringify(loadManifest, null, 2));

        bus.emitEvent({ type: 'tar-writing' });
        const filename = `${safeRepo}@${normalizedTag}.tar`;
        const tarPath = path.join(workRoot, filename);
        await tar.c({ file: tarPath, cwd: imageDir }, ['.']);

        return { tarPath, filename, workRoot };
    } catch (error) {
        try { await fs.promises.rm(workRoot, { recursive: true, force: true }); } catch {}
        throw error;
    }
}
