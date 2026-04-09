import { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { buildRpmBundle } from '@/lib/rpm/downloader';
import { uploadFileToS3 } from '@/lib/storage/s3';
import { logRequest } from '@/lib/requestLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const body = await req.json();
    const packages = Array.isArray(body.packages) ? body.packages.map((s: any) => String(s).trim()).filter(Boolean) : [];
    const bundleName = typeof body.bundleName === 'string' && body.bundleName.trim() ? body.bundleName.trim() : 'rpm-offline';
    const repositories = Array.isArray(body.repositories) ? body.repositories.map((s: any) => String(s).trim()).filter(Boolean) : [];
    const resolveDependencies = body.resolveDependencies !== false;

    if (!packages.length) {
        return new Response(JSON.stringify({ error: 'packages[] is required' }), { status: 400 });
    }

    const jobId = nanoid();
    const bus = new ProgressBus();
    jobStore.set(jobId, { status: 'queued' });
    globalBusMap.set(jobId, bus);
    bus.emitEvent({ type: 'stage', stage: 'queued' });
    bus.emitEvent({ type: 'log', level: 'info', message: `ジョブを受け付けました: ${jobId}` });

    logRequest(req, `rpm:start job=${jobId}`);

    (async () => {
        let workRoot: string | undefined;
        try {
            jobStore.set(jobId, { status: 'running' });
            bus.emitEvent({ type: 'log', level: 'info', message: `開始パッケージ: ${packages.join(', ')}` });
            const { tarPath, filename, workRoot: root } = await buildRpmBundle({
                specs: packages,
                bundleName,
                selectedRepos: repositories,
                resolveDependencies,
                bus,
            });
            workRoot = root;
            const objectKey = `${jobId}/${filename}`;
            bus.emitEvent({ type: 'stage', stage: 'uploading-s3' });
            bus.emitEvent({ type: 'log', level: 'info', message: 'S3へアップロード中です。' });
            await uploadFileToS3({ filePath: tarPath, key: objectKey, contentType: 'application/x-tar' });
            jobStore.set(jobId, { status: 'done', filename, objectKey });
            bus.emitEvent({ type: 'log', level: 'info', message: 'RPMバンドルの生成が完了しました。' });
        } catch (err: any) {
            jobStore.set(jobId, { status: 'error', error: err?.message || 'failed' });
            bus.emitEvent({ type: 'error', message: err?.message || 'failed' });
        } finally {
            if (workRoot) {
                try { await fs.rm(workRoot, { recursive: true, force: true }); } catch {}
            }
        }
    })();

    return new Response(JSON.stringify({ jobId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
