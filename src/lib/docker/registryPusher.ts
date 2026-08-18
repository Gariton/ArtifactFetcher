import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import axios, { type AxiosProgressEvent } from 'axios';
import * as tar from 'tar';
import { ProgressBus } from '@/lib/progressBus';
import { Agent as HttpsAgent } from 'https';
import os from 'node:os';
import { assertDockerRepository, assertDockerTag, resolveWithin } from '@/lib/inputSafety';
import { assertFileSize, assertItemCount, ByteBudget } from '@/lib/resourceLimits';
import { MAX_DOCKER_MANIFEST_BYTES } from '@/lib/docker/readDockerLoadManifest';

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

function authHeader(username?: string, password?: string): Record<string, string> {
  if (!username) return {} as Record<string, string>;
  const token = Buffer.from(`${username}:${password || ''}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

function axiosClient(baseURL: string, insecureTLS?: boolean, extraHeaders?: Record<string,string>) {
    return axios.create({
        baseURL,
        timeout: 60_000,
        httpsAgent: insecureTLS ? new HttpsAgent({ rejectUnauthorized: false }) : undefined,
        headers: { ...(extraHeaders || {}) },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        maxRedirects: 0,
        validateStatus: (s) => (s >= 200 && s < 500),
    });
}

export function resolveDockerUploadLocation(rawLocation: string, registryBase: string): string {
    const base = new URL(registryBase);
    let resolved: URL;
    try {
        const directoryBase = base.toString().endsWith('/') ? base.toString() : `${base.toString()}/`;
        resolved = new URL(rawLocation, directoryBase);
    } catch {
        throw new Error('registry returned an invalid upload location');
    }
    if (!['http:', 'https:'].includes(resolved.protocol)) {
        throw new Error('registry returned an unsupported upload location');
    }

    const wantPrefix = base.pathname.replace(/\/+$/, '');
    if (resolved.pathname.startsWith('/v2/') && wantPrefix) {
        resolved.pathname = `${wantPrefix}${resolved.pathname}`;
    }

    // Never allow a registry response to redirect upload credentials or layer data
    // to a different origin. Nexus may advertise its internal host in Location.
    resolved.protocol = base.protocol;
    resolved.host = base.host;
    resolved.username = '';
    resolved.password = '';
    resolved.hash = '';
    return resolved.toString();
}

export function normalizeDockerRegistryUrl(raw: string, hasCredentials = false): string {
    let url: URL;
    try { url = new URL(raw.trim()); }
    catch { throw new Error('Docker registry URL is invalid'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('Docker registry URL must be HTTP(S) without credentials, query, or fragment');
    }
    if (hasCredentials && url.protocol !== 'https:') {
        throw new Error('Docker registry credentials require an HTTPS registry URL');
    }
    return url.toString();
}

export async function extractDockerArchive(tarPath: string): Promise<string> {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'));
    try {
        let entries = 0;
        const budget = new ByteBudget();
        let validationError: Error | undefined;
        await tar.x({
            file: tarPath,
            cwd: temp,
            strict: true,
            preservePaths: false,
            filter: (entryPath, entry) => {
                if (validationError) return false;
                try {
                    const normalized = entryPath.replace(/^(\.\/)+/, '');
                    if (path.isAbsolute(normalized) || normalized.split(/[\\/]/).includes('..')) {
                        throw new Error(`unsafe path in Docker archive: ${entryPath}`);
                    }
                    entries += 1;
                    assertItemCount(entries, 'Docker archive entry');
                    const size = Number(entry?.size || 0);
                    assertFileSize(size || undefined, `Docker archive entry ${entryPath}`);
                    if (normalized === 'manifest.json' && size > MAX_DOCKER_MANIFEST_BYTES) {
                        throw new Error(`Docker manifest exceeds ${MAX_DOCKER_MANIFEST_BYTES} bytes`);
                    }
                    budget.consume(size, 'Docker archive');
                    const entryType = entry && 'type' in entry ? entry.type : undefined;
                    if (!entryType || !['File', 'OldFile', 'Directory'].includes(entryType)) {
                        throw new Error(`unsupported link or special entry in Docker archive: ${entryPath}`);
                    }
                    return true;
                } catch (error) {
                    validationError = error instanceof Error ? error : new Error('invalid Docker archive');
                    return false;
                }
            },
        });
        if (validationError) throw validationError;
        return temp;
    } catch (error) {
        try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
        throw error;
    }
}

function resolveRegularFileWithin(root: string, relativePath: string): string {
    const candidate = resolveWithin(root, relativePath);
    const rootReal = fs.realpathSync(root);
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`Docker archive reference is not a regular file: ${relativePath}`);
    }
    const real = fs.realpathSync(candidate);
    if (real !== rootReal && !real.startsWith(`${rootReal}${path.sep}`)) {
        throw new Error(`Docker archive reference escapes extraction root: ${relativePath}`);
    }
    return real;
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

    const uploadUrl = resolveDockerUploadLocation(init.headers['location'], c.defaults.baseURL);
    
    // PATCH (stream data)
    const stat = fs.statSync(file);
    bus.emitEvent({ type: 'item-start', scope: 'push-item', manifestName: `${repo}@${tag}`, index, digest, total: stat.size });
    const stream = fs.createReadStream(file);
    const patch = await c.request({
        method: 'PATCH', url: uploadUrl,
        headers: { 'Content-Type': 'application/octet-stream', ...headers },
        data: stream,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        onUploadProgress: (p: AxiosProgressEvent) => {
            const received = p.loaded || 0;
            bus.emitEvent({ type: 'item-progress', scope: 'push-item', manifestName: `${repo}@${tag}`, index, received, total: stat.size });
        },
        maxRedirects: 0,
        validateStatus: (s: number) => s >= 200 && s < 500,
    });
    if (patch.status !== 202) throw new Error(`patch failed: ${patch.status}`);

    // finalize with digest
    const finalizeUrl = patch.headers.location
        ? resolveDockerUploadLocation(patch.headers.location, c.defaults.baseURL)
        : uploadUrl;
    const sep = finalizeUrl.includes('?') ? '&' : '?';
    const put = await c.request({
        method: 'PUT',
        url: `${finalizeUrl}${sep}digest=${encodeURIComponent(digest)}`,
        headers: { ...headers },
        maxRedirects: 0,
        validateStatus: (s: number) => s >= 200 && s < 500,
    });
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
    const { sourceTarPath, sourceDir, username, password, insecureTLS, bus } = opts;
    const registryUrl = new URL(normalizeDockerRegistryUrl(opts.registry, Boolean(username || password)));
    const repository = assertDockerRepository(opts.repository);
    const tag = assertDockerTag(opts.tag);
    bus.emitEvent({ type: 'stage', stage: 'prepare' });
    
    // materialize input
    let workDir = sourceDir;
    let ownsWorkDir = false;
    if (!workDir) {
        if (!sourceTarPath) throw new Error('sourceTarPath or sourceDir is required');
        workDir = await extractDockerArchive(sourceTarPath);
        ownsWorkDir = true;
    }

    try {
        // load manifest.json (docker load format)
        const manifestPath = resolveRegularFileWithin(workDir, 'manifest.json');
        if (fs.statSync(manifestPath).size > MAX_DOCKER_MANIFEST_BYTES) {
            throw new Error(`Docker manifest exceeds ${MAX_DOCKER_MANIFEST_BYTES} bytes`);
        }
        const manifestArr = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Array<{
            Config: string;
            RepoTags: string[];
            Layers: string[];
        }>;
        if (!Array.isArray(manifestArr) || manifestArr.length === 0) throw new Error('invalid manifest.json');
        const m0 = manifestArr[0];
        if (!m0 || typeof m0.Config !== 'string' || !Array.isArray(m0.Layers)) throw new Error('invalid manifest.json');
        assertItemCount(m0.Layers.length, 'Docker layer');

        // compute digests (config + each layer)
        bus.emitEvent({ type: 'stage', stage: 'hashing' });
        const configPath = resolveRegularFileWithin(workDir, m0.Config);
        const configDigest = await sha256File(configPath);
        const layerFiles = m0.Layers.map((layer) => resolveRegularFileWithin(workDir!, layer));
        const layerDigests: string[] = [];
        for (let i = 0; i < layerFiles.length; i++) layerDigests.push(await sha256File(layerFiles[i]));

        const layers = layerFiles.map((f, i) => ({
            mediaType: MEDIA.LAYER,
            size: fs.statSync(f).size,
            digest: layerDigests[i],
        }));

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
        const baseURL = registryUrl.toString().replace(/\/$/, '');
        const c = axiosClient(baseURL, insecureTLS, authHeader(username, password));

        // ensure /v2/ works (some registries require a ping)
        const ping = await c.get('/v2/', { headers: authHeader(username, password) });
        if (!(ping.status === 200)) throw new Error(`/v2 ping failed: ${ping.status}`);

        // upload config
        bus.emitEvent({ type: 'stage', stage: 'upload-config' });
        await pushBlob(c, repository, tag, configDigest, configPath, bus, -1, authHeader(username, password));

        // upload layers
        bus.emitEvent({ type: 'manifest-resolved', items: layers, manifestName: `${opts.repository}@${opts.tag}` } as any);
        for (let i = 0; i < layerFiles.length; i++) {
            bus.emitEvent({ type: 'stage', stage: `upload-layer-${i}` });
            await pushBlob(c, repository, tag, layerDigests[i], layerFiles[i], bus, i, authHeader(username, password));
        }

        // put manifest (tag)
        bus.emitEvent({ type: 'stage', stage: 'put-manifest' });
        await putManifest(c, repository, tag, manifest, authHeader(username, password));
    } finally {
        if (ownsWorkDir && workDir) {
            try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
        }
    }
}
