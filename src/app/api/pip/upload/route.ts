import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Busboy from 'busboy';
import { Readable } from 'node:stream';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { uploadDistribution } from '@/lib/pip/publish';
import { logRequest } from '@/lib/requestLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    const repositoryUrl = searchParams.get('repositoryUrl')?.trim() || searchParams.get('registryUrl')?.trim() || '';
    const username = searchParams.get('username')?.trim() || undefined;
    const password = searchParams.get('password') || undefined;
    const token = searchParams.get('token')?.trim() || searchParams.get('authToken')?.trim() || undefined;
    const skipExisting = (searchParams.get('skipExisting') || '').toLowerCase() === 'true';

    if (!jobId) {
        return new Response(JSON.stringify({ error: 'missing jobId' }), { status: 400 });
    }
    if (!repositoryUrl) {
        return new Response(JSON.stringify({ error: 'missing repositoryUrl' }), { status: 400 });
    }
    if (!req.body) {
        return new Response(JSON.stringify({ error: 'no body' }), { status: 400 });
    }

    logRequest(req, `pip:upload job=${jobId} -> ${repositoryUrl}`);

    const bus = globalBusMap.get(jobId) ?? new ProgressBus();
    globalBusMap.set(jobId, bus);
    jobStore.set(jobId, { status: 'queued' });

    const bb = Busboy({ headers: { 'content-type': req.headers.get('content-type') || '' } });
    const nodeStream = Readable.fromWeb(req.body as any);
    const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pip-upload-'));
    const files: Array<{ name: string; tmpPath: string; index: number }> = [];
    const saves: Promise<void>[] = [];
    let index = 0;

    const finished = new Promise<void>((resolve, reject) => {
        bb.on('file', (_field, fileStream, info) => {
            const safeName = path.basename(info.filename || `package-${Date.now()}`);
            const tmpPath = path.join(tmpRoot, `${Date.now()}-${index}-${safeName}`);
            const ws = fs.createWriteStream(tmpPath);
            const currentIndex = index++;
            files.push({ name: safeName, tmpPath, index: currentIndex });

            bus.emitEvent({ type: 'item-start', scope: 'pip-upload', index: currentIndex, digest: safeName });

            let received = 0;
            fileStream.on('data', (chunk: Buffer | string) => {
                if (typeof chunk === 'string') chunk = Buffer.from(chunk);
                received += chunk.length;
                bus.emitEvent({ type: 'item-progress', scope: 'pip-upload', index: currentIndex, received });
            });
            fileStream.on('end', () => {
                bus.emitEvent({ type: 'item-done', scope: 'pip-upload', index: currentIndex });
            });
            fileStream.on('error', reject);
            ws.on('error', reject);
            fileStream.pipe(ws);

            saves.push(new Promise<void>((res, rej) => {
                ws.on('finish', res);
                ws.on('error', rej);
                fileStream.on('error', rej);
            }));
        });
        bb.on('error', reject);
        bb.on('finish', resolve);
    });

    nodeStream.pipe(bb);

    try {
        await finished;
        await Promise.all(saves);

        if (files.length === 0) {
            bus.emitEvent({ type: 'error', message: 'no files' });
            jobStore.set(jobId, { status: 'error', error: 'no files' });
            return new Response(JSON.stringify({ error: 'no files' }), { status: 400 });
        }

        jobStore.set(jobId, { status: 'running' });
        for (const file of files) {
            jobStore.set(jobId, { status: 'running', filename: file.name });
            bus.emitEvent({ type: 'item-start', scope: 'pip-publish', index: file.index, digest: file.name });
            try {
                await uploadDistribution({
                    filePath: file.tmpPath,
                    repositoryUrl,
                    username,
                    password,
                    token,
                    skipExisting,
                });
                bus.emitEvent({ type: 'item-done', scope: 'pip-publish', index: file.index });
            } catch (err: any) {
                bus.emitEvent({ type: 'error', message: err?.message || 'failed' });
                jobStore.set(jobId, { status: 'error', error: err?.message || 'failed' });
                throw err;
            }
        }

        jobStore.set(jobId, { status: 'done', filename: `uploaded ${files.length} packages` });
        bus.emitEvent({ type: 'done', filename: `uploaded ${files.length} packages` });
        return new Response(JSON.stringify({ jobId, count: files.length }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err: any) {
        bus.emitEvent({ type: 'error', message: err?.message || 'failed' });
        return new Response(JSON.stringify({ error: err?.message || 'failed' }), { status: 500 });
    } finally {
        try { await fs.promises.rm(tmpRoot, { recursive: true, force: true }); } catch {}
    }
}
