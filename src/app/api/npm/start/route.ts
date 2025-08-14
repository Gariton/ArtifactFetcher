import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { makeLockFromSpecs } from '@/lib/npm/arboristLock';
import { buildTarFromLock } from '@/lib/npm/downloader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const { lockfile, specs, bundleName, registry } = await req.json();
    if (!lockfile && !Array.isArray(specs)) {
        return new Response(JSON.stringify({ error: 'Provide lockfile text or specs[]' }), { status: 400 });
    }
    
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
            const { tarPath, filename } = await buildTarFromLock({ lockText, bus, bundleName: bundleName || 'npm-offline' });
            jobStore.set(jobId, { status: 'done', tarPath, filename });
        } catch (e: any) {
            jobStore.set(jobId, { status: 'error', error: e?.message || 'failed' });
            bus.emitEvent({ type: 'error', message: e?.message || 'failed' });
        }
    })();
    
    return new Response(JSON.stringify({ jobId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}