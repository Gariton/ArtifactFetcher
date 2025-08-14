import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

async function fetchToken(repository: string) {
    const url = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`;
    const { data } = await requestWithRetry({ method: 'GET', url });
    return data.token as string;
}

async function getManifest(repository: string, reference: string, token: string) {
    const accept = [MEDIA.INDEX, MEDIA.MANIFEST_LIST, MEDIA.MANIFEST_OCI, MEDIA.MANIFEST_DOCKER].join(', ');
    const url = `https://registry-1.docker.io/v2/${repository}/manifests/${reference}`;
    const res = await requestWithRetry({ method: 'GET', url, headers: { Authorization: `Bearer ${token}`, Accept: accept } });
    return { data: res.data, mediaType: (res.headers['content-type'] as string)?.split(';')[0] || '' };
}

async function resolvePlatformManifest(repository: string, tag: string, platform: string, token: string, bus: ProgressBus) {
    bus.emitEvent({type: "stage", stage: "resolve-manifest"});
    const { data, mediaType } = await getManifest(repository, tag, token);
    if (mediaType === MEDIA.INDEX || mediaType === MEDIA.MANIFEST_LIST || (data as any).manifests) {
        const [osName, arch] = platform.split('/');
        const match = (data as any).manifests.find((m: any) => m.platform?.os === osName && m.platform?.architecture === arch);
        if (!match) throw new Error(`No manifest found for platform ${platform}`);
        const acc = [MEDIA.MANIFEST_OCI, MEDIA.MANIFEST_DOCKER].join(', ');
        const url = `https://registry-1.docker.io/v2/${repository}/manifests/${match.digest}`;
        const res = await requestWithRetry({ method: 'GET', url, headers: { Authorization: `Bearer ${token}`, Accept: acc } });
        return res.data;
    }
    return data; // already single-platform
}

async function downloadBlob(repository: string, digest: string, token: string, destFile: string, bus: ProgressBus, index?: number) {
    const url = `https://registry-1.docker.io/v2/${repository}/blobs/${digest}`;
    const res = await requestWithRetry({ method: 'GET', url, headers: { Authorization: `Bearer ${token}` }, responseType: 'stream' });
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
*/
export async function buildDockerImageTar({
    repository,
    tag,
    platform = 'linux/amd64',
    bus
}: {
    repository: string;
    tag: string;
    platform?: string;
    bus: ProgressBus
}): Promise<{ tarPath: string; filename: string }> {
    bus.emitEvent({ type: 'stage', stage: 'auth' });
    const token = await fetchToken(repository);
    const manifest: any = await resolvePlatformManifest(repository, tag, platform, token, bus);
    if (!manifest?.config?.digest || !Array.isArray(manifest.layers)) {
        throw new Error('Unexpected manifest structure (missing config or layers).');
    }
    bus.emitEvent({ type: 'manifest-resolved', items: manifest.layers });
    console.log(`manifestの解決完了: ${manifest.layers.length}レイヤー`)

    const safeRepo = repository.replace(/[\/]/g, '_');
    const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imgdl-'));
    const imageDir = path.join(workRoot, `${safeRepo}@${tag}`);
    await fs.promises.mkdir(imageDir, { recursive: true });

    bus.emitEvent({ type: 'stage', stage: 'download-config' });
    console.log(`configをダウンロードします`);
    const configDigest = manifest.config.digest.split(':')[1];
    const configPath = path.join(imageDir, `${configDigest}.json`);
    await downloadBlob(repository, manifest.config.digest, token, configPath, bus);

    for (let i = 0; i < manifest.layers.length; i++) {
        bus.emitEvent({ type: 'stage', stage: `download-layer-${i}` });
        console.log(`レイヤーをダウンロード: ${i}`);
        const layer = manifest.layers[i];
        const layerId = layer.digest.split(':')[1];
        const layerDir = path.join(imageDir, layerId);
        const dest = path.join(layerDir, 'layer.tar');
        await downloadBlob(repository, layer.digest, token, dest, bus, i);
    }

    const loadManifest = [
        {
            Config: `${configDigest}.json`,
            RepoTags: [`${repository}:${tag}`],
            Layers: manifest.layers.map((l: any) => `${l.digest.split(':')[1]}/layer.tar`),
        },
    ];
    await fs.promises.writeFile(path.join(imageDir, 'manifest.json'), JSON.stringify(loadManifest, null, 2));

    bus.emitEvent({ type: 'tar-writing' });
    console.log(`tar書き込み実施`)
    const filename = `${safeRepo}@${tag}.tar`;
    const tarPath = path.join(workRoot, filename);
    await tar.c({ file: tarPath, cwd: imageDir, sync: true }, ['.']);

    bus.emitEvent({ type: 'done', filename });
    console.log("完了");
    return { tarPath, filename };
}