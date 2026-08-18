import { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { buildPipBundle } from '@/lib/pip/downloader';
import { makeArtifactObjectKey, uploadFileToS3 } from '@/lib/storage/s3';
import { logRequest } from '@/lib/requestLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const body = await req.json();
    const packages = Array.isArray(body.packages) ? (body.packages as string[]).map((s) => String(s).trim()).filter(Boolean) : undefined;
    const requirementsText = typeof body.requirementsText === 'string' ? body.requirementsText : undefined;
    const bundleName = typeof body.bundleName === 'string' && body.bundleName.trim() ? body.bundleName.trim() : 'pip-offline';
    const indexUrl = typeof body.indexUrl === 'string' && body.indexUrl.trim() ? body.indexUrl.trim() : undefined;
    const extraIndexUrls = Array.isArray(body.extraIndexUrls) ? body.extraIndexUrls.map((url: any) => String(url).trim()).filter(Boolean) : [];
    const trustedHosts = Array.isArray(body.trustedHosts) ? body.trustedHosts.map((h: any) => String(h).trim()).filter(Boolean) : [];
    const username = typeof body.username === 'string' && body.username.trim() ? body.username.trim() : undefined;
    const password = typeof body.password === 'string' && body.password ? body.password : undefined;

    if ((!packages || packages.length === 0) && !requirementsText) {
        return new Response(JSON.stringify({ error: 'packages[] or requirementsText is required' }), { status: 400 });
    }

    const jobId = nanoid();
    const bus = new ProgressBus();
    if (!jobStore.create(jobId)) return Response.json({ error: 'job capacity exceeded' }, { status: 503 });
    globalBusMap.set(jobId, bus);
    bus.emitEvent({ type: 'stage', stage: 'queued' });

    logRequest(req, `pip:start job=${jobId}`);

    (async () => {
        let workRoot: string | undefined;
        try {
            jobStore.set(jobId, { status: 'running' });
            const { tarPath, filename, workRoot: root } = await buildPipBundle({
                specs: packages,
                requirementsText,
                bundleName,
                indexUrl,
                extraIndexUrls,
                trustedHosts,
                username,
                password,
                bus,
            });
            workRoot = root;
            const objectKey = makeArtifactObjectKey(jobId, filename);
            bus.emitEvent({ type: 'stage', stage: 'uploading-s3' });
            await uploadFileToS3({ filePath: tarPath, key: objectKey, contentType: 'application/x-tar' });
            jobStore.set(jobId, { status: 'done', filename, objectKey });
            bus.emitEvent({ type: 'done', filename });
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
