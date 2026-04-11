import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Busboy from 'busboy';
import { Readable } from 'node:stream';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { uploadRpmFile, type RpmUploadMethod } from '@/lib/rpm/publish';
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
    const method = ((searchParams.get('method') || 'put').toLowerCase() === 'post' ? 'post' : 'put') as RpmUploadMethod;
    const ignoreTlsVerify = ['1', 'true', 'yes', 'on'].includes((searchParams.get('ignoreTlsVerify') || '').toLowerCase());

    if (!jobId) return new Response(JSON.stringify({ error: 'missing jobId' }), { status: 400 });
    if (!repositoryUrl) return new Response(JSON.stringify({ error: 'missing repositoryUrl' }), { status: 400 });
    if (!req.body) return new Response(JSON.stringify({ error: 'no body' }), { status: 400 });

    logRequest(req, `rpm:upload job=${jobId} -> ${repositoryUrl}`);

    const bus = globalBusMap.get(jobId) ?? new ProgressBus();
    globalBusMap.set(jobId, bus);
    jobStore.set(jobId, { status: 'queued' });

    const bb = Busboy({ headers: { 'content-type': req.headers.get('content-type') || '' } });
    const nodeStream = Readable.fromWeb(req.body as any);
    const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rpm-upload-'));
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
            bus.emitEvent({ type: 'item-start', scope: 'rpm-upload', index: currentIndex, digest: safeName });

            let received = 0;
            fileStream.on('data', (chunk: Buffer | string) => {
                if (typeof chunk === 'string') chunk = Buffer.from(chunk);
                received += chunk.length;
                bus.emitEvent({ type: 'item-progress', scope: 'rpm-upload', index: currentIndex, received });
            });
            fileStream.on('end', () => bus.emitEvent({ type: 'item-done', scope: 'rpm-upload', index: currentIndex }));

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

        if (!files.length) {
            bus.emitEvent({ type: 'error', message: 'no files' });
            jobStore.set(jobId, { status: 'error', error: 'no files' });
            return new Response(JSON.stringify({ error: 'no files' }), { status: 400 });
        }

        jobStore.set(jobId, { status: 'running' });
        const successes: Array<{ name: string; index: number }> = [];
        const failures: Array<{ name: string; index: number; error: string }> = [];

        for (const file of files) {
            jobStore.set(jobId, { status: 'running', filename: file.name });
            bus.emitEvent({ type: 'item-start', scope: 'rpm-publish', index: file.index, digest: file.name });
            try {
                await uploadRpmFile({ filePath: file.tmpPath, repositoryUrl, method, username, password, token, ignoreTlsVerify });
                successes.push({ name: file.name, index: file.index });
                bus.emitEvent({ type: 'item-done', scope: 'rpm-publish', index: file.index });
            } catch (err: any) {
                const message = err?.message || 'failed';
                failures.push({ name: file.name, index: file.index, error: message });
                bus.emitEvent({ type: 'item-error', scope: 'rpm-publish', index: file.index, message });
            }
        }

        if (failures.length === files.length) {
            const lastError = failures[failures.length - 1]?.error || 'failed';
            jobStore.set(jobId, { status: 'error', error: lastError });
            bus.emitEvent({ type: 'error', message: lastError });
            return new Response(JSON.stringify({ error: lastError, failures, successes }), { status: 500 });
        }

        const summary = `uploaded ${successes.length} packages` + (failures.length ? `, ${failures.length} failed` : '');
        jobStore.set(jobId, { status: failures.length ? 'error' : 'done', filename: summary });
        if (failures.length) bus.emitEvent({ type: 'error-summary', successes, failures });
        bus.emitEvent({ type: 'done', filename: summary });
        return new Response(JSON.stringify({ jobId, count: successes.length, failures }), {
            status: failures.length ? 207 : 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err: any) {
        bus.emitEvent({ type: 'error', message: err?.message || 'failed' });
        return new Response(JSON.stringify({ error: err?.message || 'failed' }), { status: 500 });
    } finally {
        try { await fs.promises.rm(tmpRoot, { recursive: true, force: true }); } catch {}
    }
}
