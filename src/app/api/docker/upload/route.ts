import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap as busMap } from '@/lib/progressBus';
import { pushImageToRegistry } from '@/lib/docker/registryPusher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const registry   = searchParams.get('registry')   || '';
    const repository = searchParams.get('repository') || '';
    const tag        = searchParams.get('tag')        || '';
    const username   = searchParams.get('username')   || undefined;
    const password   = searchParams.get('password')   || undefined;
    const insecure   = (searchParams.get('insecureTLS') || 'false') === 'true';
    
    if (!registry || !repository || !tag) {
        return new Response(JSON.stringify({ error: 'missing registry|repository|tag' }), { status: 400 });
    }
    if (!req.body) return new Response('no body', { status: 400 });
    
    // ファイル名ヒント（任意）
    const hinted = req.headers.get('x-file-name') || `${repository.replaceAll('/','_')}@${tag}.tar`;
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'push-upload-'));
    const tarPath = path.join(tmpDir, hinted);
    
    // Node ReadableStream ← Web ReadableStream
    const reader = req.body.getReader();
    const file = fs.createWriteStream(tarPath);
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        file.write(Buffer.from(value));
    }
    await new Promise<void>((res, rej) => file.end((err: any) => err ? rej(err) : res()));
    
    // push ジョブ起動
    const jobId = nanoid();
    jobStore.set(jobId, { status: 'queued' });
    const bus = new ProgressBus();
    busMap.set(jobId, bus);
    
    (async () => {
        try {
            jobStore.set(jobId, { status: 'running' });
            await pushImageToRegistry({
                registry, repository, tag,
                sourceTarPath: tarPath,
                username, password, insecureTLS: insecure,
                bus
            });
            jobStore.set(jobId, { status: 'done', filename: `${repository}:${tag}` });
            // （アップロード済みの一時tarはここで掃除してもOK）
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        } catch (e: any) {
            jobStore.set(jobId, { status: 'error', error: e?.message || 'failed' });
            bus.emitEvent({ type: 'error', message: e?.message || 'failed' });
        }
    })();
    
    return new Response(JSON.stringify({ jobId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}