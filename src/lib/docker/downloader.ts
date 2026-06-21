import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import { ProgressBus } from "../progressBus";

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
    if (challenge.service) url.searchParams.set('service', challenge.service);
    if (challenge.scope) url.searchParams.set('scope', challenge.scope);

    const headers: Record<string, string> = {};
    const basic = buildBasicAuth(auth);
    if (basic) headers.Authorization = basic; // 認証付きトークン取得

    const res = await requestWithRetry({
        method: 'GET',
        url: url.toString(),
        headers,
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
    let reg = (input || '').trim();
    if (!reg) {
        return { host: 'docker.io', baseUrl: `https://${DOCKER_HUB_REGISTRY}`, isDockerHub: true };
    }
    let protocol = 'https';
    const schemeMatch = /^(https?):\/\//i.exec(reg);
    if (schemeMatch) {
        protocol = schemeMatch[1].toLowerCase();
        reg = reg.slice(schemeMatch[0].length);
    }
    reg = reg.replace(/\/+$/, '');
    if (reg === 'docker.io' || reg === 'index.docker.io' || reg === 'registry-1.docker.io') {
        return { host: 'docker.io', baseUrl: `https://${DOCKER_HUB_REGISTRY}`, isDockerHub: true };
    }
    return { host: reg, baseUrl: `${protocol}://${reg}`, isDockerHub: false };
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
) {
    const res = await registryGet({ baseUrl, apiPath: `/v2/${repository}/blobs/${digest}`, auth, responseType: 'stream', insecure, tokenRef });
    const total = parseInt(res.headers['content-length'] || '0', 10);
    if (typeof index === 'number') bus.emitEvent({ type: 'item-start', index, digest, total: total || undefined });

    await fs.promises.mkdir(path.dirname(destFile), { recursive: true });
    const hash = crypto.createHash('sha256');
    let received = 0;
    res.data.on('data', (chunk: Buffer) => {
        received += chunk.length;
        hash.update(chunk);
        if (typeof index === 'number') bus.emitEvent({ type: 'item-progress', index, received, total: total || undefined });
    });
    await pipeline(res.data, fs.createWriteStream(destFile));

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
    const { target, repository: repo } = resolveTarget(registry, repository);
    const auth: RegistryAuth | undefined = username ? { username, password } : undefined;
    const tokenRef: TokenRef = {};

    bus.emitEvent({ type: 'stage', stage: 'auth' });
    bus.emitEvent({ type: 'log', level: 'info', message: `レジストリ: ${target.host} / イメージ: ${repo}:${tag}` });

    const manifest: any = await resolvePlatformManifest(target.baseUrl, repo, tag, platform, auth, insecureTLS, tokenRef, bus);
    if (!manifest?.config?.digest || !Array.isArray(manifest.layers)) {
        throw new Error('Unexpected manifest structure (missing config or layers).');
    }
    bus.emitEvent({ type: 'manifest-resolved', items: manifest.layers });

    const safeRepo = repo.replace(/[\/]/g, '_');
    const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imgdl-'));
    const imageDir = path.join(workRoot, `${safeRepo}@${tag}`);
    await fs.promises.mkdir(imageDir, { recursive: true });

    bus.emitEvent({ type: 'stage', stage: 'download-config' });
    const configDigest = manifest.config.digest.split(':')[1];
    const configPath = path.join(imageDir, `${configDigest}.json`);
    await downloadBlob(target.baseUrl, repo, manifest.config.digest, auth, insecureTLS, tokenRef, configPath, bus);

    for (let i = 0; i < manifest.layers.length; i++) {
        bus.emitEvent({ type: 'stage', stage: `download-layer-${i}` });
        const layer = manifest.layers[i];
        const layerId = layer.digest.split(':')[1];
        const layerDir = path.join(imageDir, layerId);
        const dest = path.join(layerDir, 'layer.tar');
        await downloadBlob(target.baseUrl, repo, layer.digest, auth, insecureTLS, tokenRef, dest, bus, i);
    }

    // docker load 後に正しいタグが付くよう、Docker Hub 以外はホスト名を前置する。
    const refName = target.isDockerHub ? repo : `${target.host}/${repo}`;
    const loadManifest = [
        {
            Config: `${configDigest}.json`,
            RepoTags: [`${refName}:${tag}`],
            Layers: manifest.layers.map((l: any) => `${l.digest.split(':')[1]}/layer.tar`),
        },
    ];
    await fs.promises.writeFile(path.join(imageDir, 'manifest.json'), JSON.stringify(loadManifest, null, 2));

    bus.emitEvent({ type: 'tar-writing' });
    const filename = `${safeRepo}@${tag}.tar`;
    const tarPath = path.join(workRoot, filename);
    await tar.c({ file: tarPath, cwd: imageDir, sync: true }, ['.']);

    bus.emitEvent({ type: 'done', filename });
    return { tarPath, filename, workRoot };
}
