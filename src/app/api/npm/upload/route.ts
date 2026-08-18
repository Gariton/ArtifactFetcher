import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Busboy from 'busboy';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { logRequest } from '@/lib/requestLog';
import { resolveUploadAuth } from '@/lib/authHeaders';
import { normalizeNpmRegistryUrl, publishTarball } from '@/lib/npm/publish';
import { isValidJobId } from '@/lib/inputSafety';
import { RESOURCE_LIMITS } from '@/lib/resourceLimits';
import { requireUploadAccess } from '@/lib/requestSecurity';
import { waitForDrain } from '@/lib/streamSafety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 7200;

export async function POST(req: NextRequest) {
    const accessFailure = requireUploadAccess(req, 'npm');
    if (accessFailure) return accessFailure;

    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    if (!isValidJobId(jobId)) {
        return new Response(JSON.stringify({ error: 'missing jobId' }), { status: 400 });
    }
    const registryRaw = (searchParams.get('registryUrl') || searchParams.get('repositoryUrl') || '').trim();
    if (!registryRaw) {
        return new Response(JSON.stringify({ error: 'missing repositoryUrl' }), { status: 400 });
    }
    let registry: string;
    try {
        registry = normalizeNpmRegistryUrl(registryRaw);
    } catch {
        return new Response(JSON.stringify({ error: 'invalid repositoryUrl' }), { status: 400 });
    }
    const { username, password, token: authToken } = resolveUploadAuth(req.headers, {
        requestedRegistry: registry,
        configuredRegistry: process.env.NPM_UPLOAD_REGISTRY,
        defaults: {
            token: process.env.NPM_UPLOAD_AUTH_TOKEN,
            username: process.env.NPM_UPLOAD_USERNAME,
            password: process.env.NPM_UPLOAD_PASSWORD,
        },
    });
    try {
        normalizeNpmRegistryUrl(registry, Boolean(authToken || username || password));
    } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 400 });
    }
    logRequest(req, `npm:upload job=${jobId} -> ${registry}`);

    const contentType = req.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        return new Response(JSON.stringify({ error: 'content-type must be multipart/form-data' }), { status: 400 });
    }
    if (!req.body) {
        return new Response(JSON.stringify({ error: 'no body' }), { status: 400 });
    }
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > RESOURCE_LIMITS.maxUploadBytes) {
        return Response.json({ error: `upload size exceeds limit (${RESOURCE_LIMITS.maxUploadBytes} bytes)` }, { status: 413 });
    }
    let bb: ReturnType<typeof Busboy>;
    try {
        bb = Busboy({
            headers: { 'content-type': contentType },
            limits: { files: RESOURCE_LIMITS.maxUploadFiles, fileSize: RESOURCE_LIMITS.maxSingleFileBytes },
        });
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'invalid multipart request' }, { status: 400 });
    }
    if (!jobStore.claim(jobId)) {
        return Response.json({ error: 'job capacity exceeded or jobId is already in use' }, { status: 503 });
    }

    const bus = globalBusMap.get(jobId) ?? new ProgressBus();
    globalBusMap.set(jobId, bus);

    let tmpRoot: string;
    try {
        tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'npm-publish-'));
    } catch (error) {
        jobStore.delete(jobId);
        return Response.json({ error: error instanceof Error ? error.message : 'failed to create upload workspace' }, { status: 500 });
    }
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
            fileStream.on('limit', () => {
                bb.destroy(new Error(`file size exceeds limit (${RESOURCE_LIMITS.maxSingleFileBytes} bytes)`));
            });
            ws.on('error', reject);
            fileStream.pipe(ws);
            const save = new Promise<void>((res, rej) => {
                ws.on('finish', res);
                ws.on('error', rej);
                fileStream.on('error', rej);
            });
            // 中断・切断時の未処理 rejection を防ぐ（正常系は Promise.all(saves) で検知）。
            save.catch(() => {});
            saves.push(save);
        });
        bb.on('filesLimit', () => reject(new Error(`file count exceeds limit (${RESOURCE_LIMITS.maxUploadFiles})`)));
        bb.on('error', reject);
        bb.on('close', resolve);
    });

    // Web ReadableStream(req.body) を busboy へ手動で流し込む。Readable.fromWeb().pipe()
    // ではストリーム終端の伝播が不安定で busboy が "Unexpected end of form" を投げる
    // ことがあるため、最後まで読み切ってから明示的に bb.end() する。
    const pump = (async () => {
        const reader = (req.body as ReadableStream<Uint8Array>).getReader();
        let receivedTotal = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value && value.byteLength) {
                    receivedTotal += value.byteLength;
                    if (receivedTotal > RESOURCE_LIMITS.maxUploadBytes) {
                        throw new Error(`upload size exceeds limit (${RESOURCE_LIMITS.maxUploadBytes} bytes)`);
                    }
                    if (!bb.write(Buffer.from(value))) {
                        await waitForDrain(bb);
                    }
                }
            }
            bb.end();
        } catch (err) {
            await reader.cancel(err).catch(() => undefined);
            bb.destroy(err as Error);
            throw err;
        }
    })();

    bus.emitEvent({ type: 'stage', stage: 'upload-receive-start' });

    try {
        await Promise.all([finished, pump]);
        await Promise.all(saves);
        if (files.length === 0) {
            jobStore.set(jobId, { status: 'error', error: 'no files' });
            bus.emitEvent({ type: 'error', message: 'no files' });
            return new Response(JSON.stringify({ error: 'no files' }), { status: 400 });
        }

        const successes: Array<{ name: string; index: number }> = [];
        const skipped: Array<{ name: string; index: number; packageId: string }> = [];
        const failures: Array<{ name: string; index: number; error: string }> = [];

        bus.emitEvent({ type: 'stage', stage: 'npm-publish-start' });
        for (let i = 0; i < files.length; i++) {
            const file = files[i]!;
            jobStore.set(jobId, { status: 'running', filename: file.name });
            bus.emitEvent({ type: 'item-start', scope: 'npm-publish', index: file.index, digest: file.name });
            try {
                const result = await publishTarball({
                    tarballPath: file.tmpPath,
                    registry,
                    authToken,
                    username,
                    password,
                });
                if (result.status === 'skipped') {
                    skipped.push({ name: file.name, index: file.index, packageId: result.packageId });
                    bus.emitEvent({
                        type: 'item-skip',
                        scope: 'npm-publish',
                        index: file.index,
                        reason: `${result.packageId} already exists`,
                    });
                } else {
                    successes.push({ name: file.name, index: file.index });
                    bus.emitEvent({ type: 'item-done', scope: 'npm-publish', index: file.index });
                }
            } catch (err: any) {
                const message = err?.message || 'publish failed';
                failures.push({ name: file.name, index: file.index, error: message });
                bus.emitEvent({ type: 'item-error', scope: 'npm-publish', index: file.index, message });
            }
        }

        if (failures.length === files.length) {
            const lastError = failures[failures.length - 1]?.error || 'failed';
            jobStore.set(jobId, { status: 'error', error: lastError });
            bus.emitEvent({ type: 'error', message: lastError });
            return new Response(JSON.stringify({ error: lastError, failures, successes }), { status: 500 });
        }

        const summary = `published ${successes.length} packages`
            + (skipped.length ? `, ${skipped.length} already existed` : '')
            + (failures.length ? `, ${failures.length} failed` : '');
        jobStore.set(jobId, { status: failures.length ? 'error' : 'done', filename: summary });
        if (failures.length) {
            bus.emitEvent({ type: 'error-summary', successes, failures });
            bus.emitEvent({ type: 'error', message: summary });
        } else {
            bus.emitEvent({ type: 'done', filename: summary });
        }
        return new Response(JSON.stringify({ jobId, count: successes.length, skipped, failures }), {
            status: failures.length ? 207 : 200,
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
