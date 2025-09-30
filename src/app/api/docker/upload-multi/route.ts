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

    jobStore.set(jobId, { status: 'running' });

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
            
            const successes: Array<{ name: string; index: number }> = [];
            const failures: Array<{ name: string; index: number; error: string }> = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i]!;
                const repotag = repoTags[i]!;
                const { repository, tag } = repotag;
                jobStore.set(jobId, { status: 'running', filename: file.name });
                bus.emitEvent({ type: 'stage', stage: `push-start: ${file.name} -> ${repository}:${tag}` });
                bus.emitEvent({ type: 'item-start', scope: 'push-image', index: i, digest: `${repository}:${tag}` });
                try {
                    await pushImageToRegistry({
                        registry: ctx.registry,
                        repository,
                        tag,
                        sourceTarPath: file.tmpPath,
                        username: ctx.username,
                        password: ctx.password,
                        insecureTLS: ctx.insecureTLS,
                        bus,
                    });
                    successes.push({ name: file.name, index: i });
                    bus.emitEvent({ type: 'item-done', scope: 'push-image', index: i });
                } catch (err: any) {
                    const message = err?.message || 'push failed';
                    failures.push({ name: file.name, index: i, error: message });
                    bus.emitEvent({ type: 'item-error', scope: 'push-image', index: i, message });
                }
            }

            if (failures.length === files.length) {
                const lastError = failures[failures.length - 1]?.error || 'failed';
                jobStore.set(jobId, { status: 'error', error: lastError });
                bus.emitEvent({ type: 'error', message: lastError });
                return;
            }

            const summary = `pushed ${successes.length} images` + (failures.length ? `, ${failures.length} failed` : '');
            jobStore.set(jobId, { status: failures.length ? 'error' : 'done', filename: summary });
            if (failures.length) {
                bus.emitEvent({ type: 'error-summary', successes, failures });
            }
            bus.emitEvent({ type: 'done', filename: summary });

        } catch (e: any) {
            jobStore.set(jobId, { status: 'error', error: e?.message || 'failed' });
            bus.emitEvent({ type: 'error', message: e?.message || 'failed' });
        } finally {
            try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
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
