import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { nanoid } from 'nanoid';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap as busMap } from '@/lib/progressBus';
import { pushImageToRegistry } from '@/lib/docker/registryPusher';
import { readUploadAuth } from '@/lib/authHeaders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const registry   = searchParams.get('registry')   || '';
    const repository = searchParams.get('repository') || '';
    const tag        = searchParams.get('tag')        || '';
    const { username, password } = readUploadAuth(req.headers);
    const insecure   = (searchParams.get('insecureTLS') || 'false') === 'true';

    if (!registry || !repository || !tag) {
        return new Response(JSON.stringify({ error: 'missing registry|repository|tag' }), { status: 400 });
    }
    if (!req.body) return new Response('no body', { status: 400 });

    // ファイル名ヒント（任意）。path.basename でパストラバーサルを防ぐ。
    const hinted = path.basename(req.headers.get('x-file-name') || `${repository.replaceAll('/','_')}@${tag}.tar`);
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'push-upload-'));
    const tarPath = path.join(tmpDir, hinted);

    // Web ReadableStream → Node stream へ。pipeline がバックプレッシャを処理する。
    await pipeline(Readable.fromWeb(req.body as any), fs.createWriteStream(tarPath));

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