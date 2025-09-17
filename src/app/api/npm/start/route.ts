import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import fs from 'node:fs/promises';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { makeLockFromSpecs } from '@/lib/npm/arboristLock';
import { buildTarFromLock } from '@/lib/npm/downloader';
import { uploadFileToS3 } from '@/lib/storage/s3';
import { logRequest } from '@/lib/requestLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const { lockfile, specs, bundleName, registry } = await req.json();
    if (!lockfile && !Array.isArray(specs)) {
        return new Response(JSON.stringify({ error: 'Provide lockfile text or specs[]' }), { status: 400 });
    }

    const detail = Array.isArray(specs)
        ? `npm:start specs=${specs.length}`
        : 'npm:start lockfile';
    logRequest(req, detail);
    
    const jobId = nanoid();
    jobStore.set(jobId, { status: 'queued' });
    
    const bus = new ProgressBus();
    globalBusMap.set(jobId, bus);
    bus.emitEvent({ type: 'stage', stage: 'queued' });
    
    (async () => {
        try {
            jobStore.set(jobId, { status: 'running' });
            let lockText: string;
            if (Array.isArray(specs)) {
                const { lockText: lt } = await makeLockFromSpecs(specs, bus, registry);
                lockText = lt;
            } else {
                lockText = String(lockfile);
            }
            let workRoot: string | undefined;
            try {
                const { tarPath, filename, workRoot: tmpRoot } = await buildTarFromLock({ lockText, bus, bundleName: bundleName || 'npm-offline' });
                workRoot = tmpRoot;
                const objectKey = `${jobId}/${filename}`;
                bus.emitEvent({ type: 'stage', stage: 'uploading-s3' });
                await uploadFileToS3({ filePath: tarPath, key: objectKey, contentType: 'application/x-tar' });
                jobStore.set(jobId, { status: 'done', filename, objectKey });
            } finally {
                if (workRoot) {
                    try { await fs.rm(workRoot, { recursive: true, force: true }); } catch {}
                }
            }
        } catch (e: any) {
            jobStore.set(jobId, { status: 'error', error: e?.message || 'failed' });
            bus.emitEvent({ type: 'error', message: e?.message || 'failed' });
        }
    })();
    
    return new Response(JSON.stringify({ jobId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
