import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import axios, { AxiosRequestConfig } from 'axios';
import * as tar from 'tar';
import { ProgressBus } from '@/lib/progressBus';

export type PushOptions = {
    registry: string;           // e.g. https://nexus.example.com
    repository: string;         // e.g. myproj/redis
    tag: string;                // e.g. 7.2
    sourceTarPath?: string;     // path to docker-load tar built by our downloader
    sourceDir?: string;         // alternatively, directory containing manifest.json + layers/
    username?: string;          // basic auth (Nexus3)
    password?: string;
    insecureTLS?: boolean;      // allow self-signed
    bus: ProgressBus;
};

const MEDIA = {
    MANIFEST: 'application/vnd.docker.distribution.manifest.v2+json',
    CONFIG: 'application/vnd.docker.container.image.v1+json',
    LAYER: 'application/vnd.docker.image.rootfs.diff.tar',
};

function authHeader(username?: string, password?: string) {
    if (!username) return {};
    const token = Buffer.from(`${username}:${password || ''}`).toString('base64');
    return { Authorization: `Basic ${token}` };
}

function axiosClient(baseURL: string, insecureTLS?: boolean, extraHeaders?: Record<string,string>) {
    return axios.create({
        baseURL,
        timeout: 60_000,
        // @ts-expect-error - node only option
        httpsAgent: insecureTLS ? new (require('https').Agent)({ rejectUnauthorized: false }) : undefined,
        headers: { ...(extraHeaders || {}) },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: (s) => (s >= 200 && s < 500),
    });
}

async function ensureDirFromTar(tarPath: string): Promise<string> {
    const temp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'push-'));
    await tar.x({ file: tarPath, cwd: temp, sync: true });
    return temp;
}

async function sha256File(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(filePath), hash as any);
    return `sha256:${hash.digest('hex')}`;
}

async function headBlob(c: any, repo: string, digest: string, headers: any) {
    return c.head(`/v2/${repo}/blobs/${digest}`, { headers });
}

async function startUpload(c: any, repo: string, headers: any) {
    return c.post(`/v2/${repo}/blobs/uploads/`, null, { headers });
}

async function pushBlob(c: any, repo: string, tag: string, digest: string, file: string, bus: ProgressBus, index: number, headers: any) {
    // existence check
    const head = await headBlob(c, repo, digest, headers);
    if (head.status === 200) {
        // bus.emitEvent({ type: 'item-start', scope: 'push-item', manifestName: `${repo}@${tag}`, index, total: 100, digest});
        // bus.emitEvent({ type: 'item-progress', scope: 'push-item', manifestName: `${repo}@${tag}`, index, received: 100});
        // bus.emitEvent({ type: 'item-done', scope: 'push-item', manifestName: `${repo}@${tag}`, index });
        bus.emitEvent({ type: 'item-skip', scope: 'push-item', manifestName: `${repo}@${tag}`, index, reason: "exists"});
        return;
    }
    
    // initiate upload
    const init = await startUpload(c, repo, headers);
    if (!(init.status === 202 && init.headers['location'])) throw new Error(`init upload failed: ${init.status}`);
    // Location may be absolute or relative
    // const uploadUrl = new URL(init.headers['location'], c.defaults.baseURL).toString();

    const rawLocation = init.headers['location'];           // 例: /v2/...  or http://127.0.0.1:8081/v2/...
    const base = new URL(c.defaults.baseURL);               // 例: https://nexus/repository/docker-hub-clone
    const wantPrefix = '/repository/docker-hub-clone';      // ← registry のパス部分を抽出しておく

    let uploadUrl: string;
    if (/^https?:\/\//i.test(rawLocation)) {
        // フルURLで返ってきた場合：ホスト/プロトコルを前段に合わせ、パスを補正
        const u = new URL(rawLocation);
        // Location が /v2/... だけを返す実装なら、prefix を付ける
        if (u.pathname.startsWith('/v2/')) {
            u.pathname = `${wantPrefix}${u.pathname}`;          // /repository/docker-hub-clone/v2/...
        }
        u.protocol = base.protocol; u.host = base.host;
        uploadUrl = u.toString();
    } else {
        // 相対で返ってきた場合
        const u = new URL(rawLocation, base);
        if (u.pathname.startsWith('/v2/')) {
            u.pathname = `${wantPrefix}${u.pathname}`;
        }
        uploadUrl = u.toString();
    }
    
    // PATCH (stream data)
    const stat = fs.statSync(file);
    bus.emitEvent({ type: 'item-start', scope: 'push-item', manifestName: `${repo}@${tag}`, index, digest, total: stat.size });
    const stream = fs.createReadStream(file);
    const patch = await axios.request({
        method: 'PATCH', url: uploadUrl,
        headers: { 'Content-Type': 'application/octet-stream', ...headers },
        data: stream,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        onUploadProgress: (p) => {
            const received = p.loaded || 0;
            bus.emitEvent({ type: 'item-progress', scope: 'push-item', manifestName: `${repo}@${tag}`, index, received, total: stat.size });
        },
        validateStatus: s => s >= 200 && s < 500,
    } as AxiosRequestConfig);
    if (patch.status !== 202) throw new Error(`patch failed: ${patch.status}`);
    
    // finalize with digest
    const sep = uploadUrl.includes('?') ? '&' : '?';
    const put = await axios.request({
        method: 'PUT',
        url: `${uploadUrl}${sep}digest=${encodeURIComponent(digest)}`,
        headers: { ...headers },
        validateStatus: s => s >= 200 && s < 500,
    });
    // const put = await axios.request({
    //     method: 'PUT', url: `${uploadUrl}&digest=${encodeURIComponent(digest)}`,
    //     headers: { ...headers },
    //     validateStatus: s => s >= 200 && s < 500,
    // } as AxiosRequestConfig);
    if (put.status !== 201) throw new Error(`finalize failed: ${put.status}`);
    bus.emitEvent({ type: 'item-done', scope: 'push-item', manifestName: `${repo}@${tag}`, index });
}

async function putManifest(c: any, repo: string, tag: string, manifest: any, headers: any) {
    const res = await c.put(`/v2/${repo}/manifests/${encodeURIComponent(tag)}`, JSON.stringify(manifest), {
        headers: { 'Content-Type': MEDIA.MANIFEST, ...headers },
    });
    if (!(res.status === 201 || res.status === 202)) throw new Error(`manifest put failed: ${res.status}`);
}

export async function pushImageToRegistry(opts: PushOptions) {
    const { registry, repository, tag, sourceTarPath, sourceDir, username, password, insecureTLS, bus } = opts;
    bus.emitEvent({ type: 'stage', stage: 'prepare' });
    
    // materialize input
    let workDir = sourceDir;
    if (!workDir) {
        if (!sourceTarPath) throw new Error('sourceTarPath or sourceDir is required');
        workDir = await ensureDirFromTar(sourceTarPath);
    }
    
    // load manifest.json (docker load format)
    const manifestPath = path.join(workDir!, 'manifest.json');
    const manifestArr = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Array<{
        Config: string;
        RepoTags: string[];
        Layers: string[];
    }>;
    if (!Array.isArray(manifestArr) || manifestArr.length === 0) throw new Error('invalid manifest.json');
    const m0 = manifestArr[0];
    
    // compute digests (config + each layer)
    bus.emitEvent({ type: 'stage', stage: 'hashing' });
    const configPath = path.join(workDir!, m0.Config);
    const configDigest = await sha256File(configPath);
    const layerFiles = m0.Layers.map(l => path.join(workDir!, l));
    const layerDigests: string[] = [];
    for (let i = 0; i < layerFiles.length; i++) layerDigests.push(await sha256File(layerFiles[i]));
    
    const layers = layerFiles.map((f, i) => ({
        mediaType: MEDIA.LAYER,
        size: fs.statSync(f).size,
        digest: layerDigests[i],
    }))

    // build OCI manifest (schema2)
    const manifest = {
        schemaVersion: 2,
        mediaType: MEDIA.MANIFEST,
        config: {
            mediaType: MEDIA.CONFIG,
            size: fs.statSync(configPath).size,
            digest: configDigest,
        },
        layers
    };
    
    // client
    const baseURL = registry.replace(/\/$/, '');
    const c = axiosClient(baseURL, insecureTLS, authHeader(username, password));
    
    // ensure /v2/ works (some registries require a ping)
    const ping = await c.get('/v2/', { headers: authHeader(username, password) });
    if (!(ping.status === 200)) throw new Error(`/v2 ping failed: ${ping.status}`);
    
    // upload config
    bus.emitEvent({ type: 'stage', stage: 'upload-config' });
    await pushBlob(c, repository, tag, configDigest, configPath, bus, -1, authHeader(username, password));
    
    // upload layers
    console.log('emit manifest-resolved', `${opts.repository}@${opts.tag}`);
    bus.emitEvent({ type: 'manifest-resolved', items: layers, manifestName: `${opts.repository}@${opts.tag}` } as any);
    for (let i = 0; i < layerFiles.length; i++) {
        bus.emitEvent({ type: 'stage', stage: `upload-layer-${i}` });
        await pushBlob(c, repository, tag, layerDigests[i], layerFiles[i], bus, i, authHeader(username, password));
    }
    
    // put manifest (tag)
    bus.emitEvent({ type: 'stage', stage: 'put-manifest' });
    await putManifest(c, repository, tag, manifest, authHeader(username, password));
}