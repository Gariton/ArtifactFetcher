import { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { buildHfBundle } from '@/lib/hf/downloader';
import { uploadFileToS3 } from '@/lib/storage/s3';
import { logRequest } from '@/lib/requestLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function normalizePatterns(input: unknown, fallback: string[]) {
    if (!Array.isArray(input)) return fallback;
    const rows = input.map((item) => String(item).trim()).filter(Boolean);
    return rows.length ? rows : fallback;
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const repoId = typeof body.repoId === 'string' ? body.repoId.trim() : '';
    const revision = typeof body.revision === 'string' && body.revision.trim() ? body.revision.trim() : 'main';
    const bundleName = typeof body.bundleName === 'string' && body.bundleName.trim() ? body.bundleName.trim() : undefined;
    const token = typeof body.token === 'string' && body.token.trim() ? body.token.trim() : undefined;
    const includePatterns = normalizePatterns(body.includePatterns, ['*.gguf', '*.json', 'tokenizer*', '*.model']);
    const excludePatterns = normalizePatterns(body.excludePatterns, []);

    if (!repoId) {
        return new Response(JSON.stringify({ error: 'repoId is required' }), { status: 400 });
    }

    const jobId = nanoid();
    const bus = new ProgressBus();
    jobStore.set(jobId, { status: 'queued' });
    globalBusMap.set(jobId, bus);
    bus.emitEvent({ type: 'stage', stage: 'queued' });

    logRequest(req, `hf:start job=${jobId}`);

    (async () => {
        let workRoot: string | undefined;
        try {
            jobStore.set(jobId, { status: 'running' });
            const { tarPath, filename, workRoot: root } = await buildHfBundle({
                repoId,
                revision,
                bundleName,
                includePatterns,
                excludePatterns,
                token,
                bus,
            });
            workRoot = root;

            const objectKey = `${jobId}/${filename}`;
            bus.emitEvent({ type: 'stage', stage: 'uploading-s3' });
            await uploadFileToS3({ filePath: tarPath, key: objectKey, contentType: 'application/x-tar' });
            jobStore.set(jobId, { status: 'done', filename, objectKey });
        } catch (err: any) {
            jobStore.set(jobId, { status: 'error', error: err?.message || 'failed' });
            bus.emitEvent({ type: 'error', message: err?.message || 'failed' });
        } finally {
            if (workRoot) {
                try { await fs.rm(workRoot, { recursive: true, force: true }); } catch {}
            }
        }
    })();

    return new Response(JSON.stringify({ jobId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
