import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Busboy from 'busboy';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { normalizeRpmRepositoryUrl, uploadRpmFile, type RpmUploadMethod } from '@/lib/rpm/publish';
import { logRequest } from '@/lib/requestLog';
import { resolveUploadAuth } from '@/lib/authHeaders';
import { requireUploadAccess } from '@/lib/requestSecurity';
import { isValidJobId } from '@/lib/inputSafety';
import { RESOURCE_LIMITS } from '@/lib/resourceLimits';
import { waitForDrain } from '@/lib/streamSafety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const accessFailure = requireUploadAccess(req, 'rpm');
    if (accessFailure) return accessFailure;

    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    const repositoryUrlRaw = searchParams.get('repositoryUrl')?.trim() || searchParams.get('registryUrl')?.trim() || '';
    let repositoryUrl: string;
    try {
        repositoryUrl = normalizeRpmRepositoryUrl(repositoryUrlRaw);
    } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 400 });
    }
    const { username, password, token } = resolveUploadAuth(req.headers, {
        requestedRegistry: repositoryUrl,
        configuredRegistry: process.env.RPM_UPLOAD_REPOSITORY_URL,
        defaults: {
            username: process.env.RPM_UPLOAD_USERNAME,
            password: process.env.RPM_UPLOAD_PASSWORD,
            token: process.env.RPM_UPLOAD_TOKEN,
        },
    });
    const method = ((searchParams.get('method') || 'put').toLowerCase() === 'post' ? 'post' : 'put') as RpmUploadMethod;
    const ignoreTlsVerify = ['1', 'true', 'yes', 'on'].includes((searchParams.get('ignoreTlsVerify') || '').toLowerCase());

    if (!isValidJobId(jobId)) return new Response(JSON.stringify({ error: 'missing jobId' }), { status: 400 });
    try {
        normalizeRpmRepositoryUrl(repositoryUrl, Boolean(username || password || token));
    } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 400 });
    }
    if (!req.body) return new Response(JSON.stringify({ error: 'no body' }), { status: 400 });
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        return Response.json({ error: 'content-type must be multipart/form-data' }, { status: 400 });
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

    logRequest(req, `rpm:upload job=${jobId} -> ${repositoryUrl}`);

    const bus = globalBusMap.get(jobId) ?? new ProgressBus();
    globalBusMap.set(jobId, bus);

    let tmpRoot: string;
    try {
        tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rpm-upload-'));
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
            bus.emitEvent({ type: 'item-start', scope: 'rpm-upload', index: currentIndex, digest: safeName });

            let received = 0;
            fileStream.on('data', (chunk: Buffer | string) => {
                if (typeof chunk === 'string') chunk = Buffer.from(chunk);
                received += chunk.length;
                bus.emitEvent({ type: 'item-progress', scope: 'rpm-upload', index: currentIndex, received });
            });
            fileStream.on('end', () => bus.emitEvent({ type: 'item-done', scope: 'rpm-upload', index: currentIndex }));

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

    try {
        await Promise.all([finished, pump]);
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
                await uploadRpmFile({ filePath: file.tmpPath, fileName: file.name, repositoryUrl, method, username, password, token, ignoreTlsVerify });
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
        if (failures.length) {
            bus.emitEvent({ type: 'error-summary', successes, failures });
            bus.emitEvent({ type: 'error', message: summary });
        } else {
            bus.emitEvent({ type: 'done', filename: summary });
        }
        return new Response(JSON.stringify({ jobId, count: successes.length, failures }), {
            status: failures.length ? 207 : 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err: any) {
        const message = err?.message || 'failed';
        jobStore.set(jobId, { status: 'error', error: message });
        bus.emitEvent({ type: 'error', message });
        return new Response(JSON.stringify({ error: message }), { status: 500 });
    } finally {
        try { await fs.promises.rm(tmpRoot, { recursive: true, force: true }); } catch {}
    }
}
