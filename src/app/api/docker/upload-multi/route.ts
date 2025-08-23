// app/api/push/upload-multi/route.ts
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import Busboy from 'busboy';
import { jobStore } from '@/lib/jobStore';
import { FileInfo, ProgressBus, RepoTag, globalBusMap as busMap } from '@/lib/progressBus';
import { pushImageToRegistry } from '@/lib/docker/registryPusher';
import { readLoadManifestFromTar, repoTagFromRepoTags } from '@/lib/docker/readDockerLoadManifest';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type PushCtx = {
    jobId: string;
    registry: string;
    repository: string;
    tag?: string;            // 単一タグ指定（ファイル名から推測も可）
    username?: string;
    password?: string;
    insecureTLS?: boolean;
    concurrency?: number;    // 省略時 1（逐次）
};

export async function POST(req: NextRequest) {
    // クエリで push 先の共通設定を受ける
    const { searchParams } = new URL(req.url);
    const useManifest = (searchParams.get('useManifest') || 'false') === 'true';
    const jobId = searchParams.get("jobId");
    if (!jobId) {
        return new Response(JSON.stringify({error: 'missing jobId'}), {status: 400});
    }
    const ctx: PushCtx = {
        jobId,
        registry:  searchParams.get('registry')   || '',
        repository: (searchParams.get('repository') || '').toLowerCase(),
        tag:       searchParams.get('tag') || undefined,
        username:  searchParams.get('username') || undefined,
        password:  searchParams.get('password') || undefined,
        insecureTLS: (searchParams.get('insecureTLS') || 'false') === 'true',
        concurrency: Number(searchParams.get('concurrency') || '1'),
    };
    if (!ctx.registry) {
        return new Response(JSON.stringify({ error: 'missing registry' }), { status: 400 });
    }
    if (!req.body) return new Response('no body', { status: 400 });
    
    const bus = busMap.get(ctx.jobId) ?? new ProgressBus();
    busMap.set(ctx.jobId, bus);

    bus.emitEvent({type: "stage", stage: "upload-receive-start"});

    // 受け取り先
    const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'push-multi-'));
    const files: Array<FileInfo> = [];
    const saves: Promise<void>[] = [];

    // --- multipart をストリーミングで保存 ---
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        return new Response(JSON.stringify({ error: 'content-type must be multipart/form-data' }), { status: 400 });
    }
    
    const bb = Busboy({ headers: { 'content-type': contentType } });
    const nodeReadable = Readable.fromWeb(req.body as any);
    
    let uploadIndex = 0;

    const finished = new Promise<void>((resolve, reject) => {
        bb.on('file', (_field, fileStream, info) => {
            const safeName = path.basename(info.filename || `file-${Date.now()}.tar`);
            const tmpPath = path.join(tmpRoot, safeName);
            const ws = fs.createWriteStream(tmpPath);
            files.push({ name: safeName, tmpPath });

            const myIndex = uploadIndex++;
            let received = 0;
            bus.emitEvent({type: 'item-start', scope: 'upload', index: myIndex, digest: safeName});
            
            fileStream.on('data', (chunk: Buffer) => {
                received += chunk.length;
                bus.emitEvent({type: 'item-progress', scope: 'upload', index: myIndex, received});
            });
            fileStream.on("end", () => {
                bus.emitEvent({type: 'item-done', scope: 'upload', index: myIndex});
            })
            fileStream.pipe(ws);

            saves.push(new Promise<void>((resolve, reject) => {
              ws.on('finish', resolve);
              ws.on('error', reject);
              fileStream.on('error', reject);
            }));
        });
        bb.on('error', reject);
        bb.on('finish', resolve);
    });
    
    nodeReadable.pipe(bb);
    await finished;
    await Promise.all(saves);
    
    if (files.length === 0) {
        return new Response(JSON.stringify({ error: 'no files' }), { status: 400 });
    }
    
    (async () => {
        try {
            // 全体の件数を先に通知
            bus.emitEvent({ type: 'stage', stage: 'prepare' });

            // 先にrepoとtagを割り出す
            const repoTags: RepoTag[] = await Promise.all(files.map(async f => {
                let repository = ctx.repository;
                let tag = ctx.tag;
                if (useManifest) {
                    const mf = await readLoadManifestFromTar(f.tmpPath);
                    if (!mf) throw new Error(`manifest.json not found in ${f.name}`);
                    const picked = repoTagFromRepoTags(mf.RepoTags);
                    if (!picked.repository || !picked.tag) {
                        throw new Error(`RepoTags invalid in ${f.name}`);
                    }
                    repository = picked.repository;
                    tag = picked.tag;
                } else {
                    if (!repository) throw new Error('repository is required when useManifest=false');
                    if (!tag) tag = guessTagFromTarName(f.name) || 'latest';
                }
                return { repository, tag };
            }));

            bus.emitEvent({ type: 'repo-tag-resolved', items: repoTags });
            
            // 逐次または並列で push
            let indexCounter = 0;
            const runOne = async (f: { name: string; tmpPath: string }, repotag: RepoTag) => {
                const idx = indexCounter++;
                const { repository, tag } = repotag;
                bus.emitEvent({ type: 'stage', stage: `push-start: ${f.name} -> ${repository}:${tag}` });
                await pushImageToRegistry({
                    registry: ctx.registry,
                    repository,
                    tag,
                    sourceTarPath: f.tmpPath,
                    username: ctx.username,
                    password: ctx.password,
                    insecureTLS: ctx.insecureTLS,
                    bus,
                });
                bus.emitEvent({ type: 'item-done', index: idx });
            };

            for (let i=0; i<files.length; i++) {
                await runOne(files[i], repoTags[i]);
            }
            
            jobStore.set(jobId, { status: 'done', filename: `pushed ${files.length} images` });
            // お掃除
            try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
            bus.emitEvent({ type: 'done', filename: `pushed ${files.length} images` });
            
        } catch (e: any) {
            jobStore.set(jobId, { status: 'error', error: e?.message || 'failed' });
            bus.emitEvent({ type: 'error', message: e?.message || 'failed' });
        }
    })();
    
    return new Response(JSON.stringify({ jobId, count: files.length }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

function guessTagFromTarName(name: string) {
    // 例: library_redis@7.2.tar → 7.2
    const m = /@([^@]+)\.tar$/i.exec(name);
    return m?.[1];
}