import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Busboy from 'busboy';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { logRequest } from '@/lib/requestLog';
import { publishTarball } from '@/lib/npm/publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    if (!jobId) {
        return new Response(JSON.stringify({ error: 'missing jobId' }), { status: 400 });
    }
    const registryRaw = (searchParams.get('registryUrl') || searchParams.get('repositoryUrl') || '').trim();
    if (!registryRaw) {
        return new Response(JSON.stringify({ error: 'missing repositoryUrl' }), { status: 400 });
    }
    let baseUrl: URL;
    try {
        baseUrl = new URL(registryRaw);
    } catch {
        return new Response(JSON.stringify({ error: 'invalid repositoryUrl' }), { status: 400 });
    }
    const username = searchParams.get('username') || undefined;
    const password = searchParams.get('password') || undefined;
    const authToken = searchParams.get('authToken') || undefined;
    logRequest(req, `npm:upload job=${jobId} -> ${baseUrl.toString()}`);

    const contentType = req.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        return new Response(JSON.stringify({ error: 'content-type must be multipart/form-data' }), { status: 400 });
    }
    if (!req.body) {
        return new Response(JSON.stringify({ error: 'no body' }), { status: 400 });
    }

    const bus = globalBusMap.get(jobId) ?? new ProgressBus();
    globalBusMap.set(jobId, bus);

    jobStore.set(jobId, { status: 'queued' });
    jobStore.set(jobId, { status: 'running' });

    const bb = Busboy({ headers: { 'content-type': contentType } });
    const nodeStream = Readable.fromWeb(req.body as any);
    const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'npm-publish-'));
    const files: Array<{ name: string; tmpPath: string; index: number }> = [];
    const saves: Promise<void>[] = [];
    let index = 0;

    const finished = new Promise<void>((resolve, reject) => {
        bb.on('file', (_field, fileStream, info) => {
            const safeName = path.basename(info.filename || `file-${Date.now()}`);
            const tmpPath = path.join(tmpRoot, `${Date.now()}-${index}-${safeName}`);
            const ws = fs.createWriteStream(tmpPath);
            const currentIndex = index++;
            files.push({ name: safeName, tmpPath, index: currentIndex });
            bus.emitEvent({ type: 'item-start', scope: 'npm-upload', index: currentIndex, digest: safeName });

            let received = 0;
            fileStream.on('data', (chunk: Buffer | string) => {
                if (typeof chunk === 'string') chunk = Buffer.from(chunk);
                received += chunk.length;
                bus.emitEvent({ type: 'item-progress', scope: 'npm-upload', index: currentIndex, received });
            });
            fileStream.on('end', () => {
                bus.emitEvent({ type: 'item-done', scope: 'npm-upload', index: currentIndex });
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

    bus.emitEvent({ type: 'stage', stage: 'upload-receive-start' });
    nodeStream.pipe(bb);

    try {
        await finished;
        await Promise.all(saves);
        if (files.length === 0) {
            jobStore.set(jobId, { status: 'error', error: 'no files' });
            bus.emitEvent({ type: 'error', message: 'no files' });
            return new Response(JSON.stringify({ error: 'no files' }), { status: 400 });
        }

        bus.emitEvent({ type: 'stage', stage: 'npm-publish-start' });
        for (let i = 0; i < files.length; i++) {
            const file = files[i]!;
            jobStore.set(jobId, { status: 'running', filename: file.name });
            bus.emitEvent({ type: 'item-start', scope: 'npm-publish', index: file.index, digest: file.name });
            try {
                await publishTarball({
                    tarballPath: file.tmpPath,
                    registry: baseUrl.toString(),
                    authToken,
                    username,
                    password,
                });
                bus.emitEvent({ type: 'item-done', scope: 'npm-publish', index: file.index });
            } catch (err) {
                throw err;
            }
        }

        jobStore.set(jobId, { status: 'done', filename: `published ${files.length} packages` });
        bus.emitEvent({ type: 'done', filename: `published ${files.length} packages` });
        return new Response(JSON.stringify({ jobId, count: files.length }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err: any) {
        jobStore.set(jobId, { status: 'error', error: err?.message || 'failed' });
        bus.emitEvent({ type: 'error', message: err?.message || 'failed' });
        return new Response(JSON.stringify({ error: err?.message || 'failed' }), { status: 500 });
    } finally {
        try { await fs.promises.rm(tmpRoot, { recursive: true, force: true }); } catch {}
    }
}
