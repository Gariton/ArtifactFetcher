import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { nanoid } from 'nanoid';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap as busMap } from '@/lib/progressBus';
import { normalizeDockerRegistryUrl, pushImageToRegistry } from '@/lib/docker/registryPusher';
import { resolveUploadAuth } from '@/lib/authHeaders';
import { requireUploadAccess } from '@/lib/requestSecurity';
import { assertFileSize, ByteBudget, RESOURCE_LIMITS } from '@/lib/resourceLimits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const accessFailure = requireUploadAccess(req, 'docker');
    if (accessFailure) return accessFailure;

    const { searchParams } = new URL(req.url);
    const registry   = searchParams.get('registry')   || '';
    const repository = searchParams.get('repository') || '';
    const tag        = searchParams.get('tag')        || '';
    const { username, password } = resolveUploadAuth(req.headers, {
        requestedRegistry: registry,
        configuredRegistry: process.env.DOCKER_UPLOAD_REGISTRY,
        defaults: {
            username: process.env.DOCKER_UPLOAD_USERNAME,
            password: process.env.DOCKER_UPLOAD_PASSWORD,
        },
    });
    const insecure   = (searchParams.get('insecureTLS') || 'false') === 'true';

    if (!registry || !repository || !tag) {
        return new Response(JSON.stringify({ error: 'missing registry|repository|tag' }), { status: 400 });
    }
    try { normalizeDockerRegistryUrl(registry, Boolean(username || password)); }
    catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
    if (!req.body) return new Response('no body', { status: 400 });
    const contentLength = Number(req.headers.get('content-length') || 0);
    try {
        assertFileSize(contentLength || undefined, 'Docker upload');
        if (contentLength > RESOURCE_LIMITS.maxUploadBytes) throw new Error('upload size exceeds limit');
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'upload too large' }, { status: 413 });
    }
    const jobId = nanoid();
    if (!jobStore.create(jobId)) {
        return Response.json({ error: 'job capacity exceeded' }, { status: 503 });
    }

    // ファイル名ヒント（任意）。path.basename でパストラバーサルを防ぐ。
    const hinted = path.basename(req.headers.get('x-file-name') || `${repository.replaceAll('/','_')}@${tag}.tar`);
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'push-upload-'));
    const tarPath = path.join(tmpDir, hinted);

    // Web ReadableStream → Node stream へ。Content-Length が無い場合も実測で制限する。
    try {
        const budget = new ByteBudget(Math.min(RESOURCE_LIMITS.maxSingleFileBytes, RESOURCE_LIMITS.maxUploadBytes));
        const limiter = new Transform({
            transform(chunk: Buffer | string, _encoding, callback) {
                try {
                    budget.consume(Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk), 'Docker upload');
                    callback(null, chunk);
                } catch (error) {
                    callback(error as Error);
                }
            },
        });
        await pipeline(Readable.fromWeb(req.body as any), limiter, fs.createWriteStream(tarPath));
    } catch (error) {
        try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
        jobStore.delete(jobId);
        return Response.json({ error: error instanceof Error ? error.message : 'upload failed' }, { status: 413 });
    }

    // push ジョブ起動
    const bus = new ProgressBus();
    busMap.set(jobId, bus);
    
    (async () => {
        try {
            jobStore.set(jobId, { status: 'running' });
            await pushImageToRegistry({
                registry, repository, tag,
                sourceTarPath: tarPath,
                username, password, insecureTLS: insecure,
                bus
            });
            jobStore.set(jobId, { status: 'done', filename: `${repository}:${tag}` });
            bus.emitEvent({ type: 'done', filename: `${repository}:${tag}` });
        } catch (e: any) {
            jobStore.set(jobId, { status: 'error', error: e?.message || 'failed' });
            bus.emitEvent({ type: 'error', message: e?.message || 'failed' });
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        }
    })();
    
    return new Response(JSON.stringify({ jobId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}
