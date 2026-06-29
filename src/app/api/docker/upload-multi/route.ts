// app/api/push/upload-multi/route.ts
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Busboy from 'busboy';
import { jobStore } from '@/lib/jobStore';
import { FileInfo, ProgressBus, RepoTag, globalBusMap as busMap } from '@/lib/progressBus';
import { pushImageToRegistry } from '@/lib/docker/registryPusher';
import { readLoadManifestFromTar, repoTagFromRepoTags } from '@/lib/docker/readDockerLoadManifest';
import { readUploadAuth } from '@/lib/authHeaders';


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
    const { username, password } = readUploadAuth(req.headers);
    const ctx: PushCtx = {
        jobId,
        registry:  searchParams.get('registry')   || '',
        repository: (searchParams.get('repository') || '').toLowerCase(),
        tag:       searchParams.get('tag') || undefined,
        username,
        password,
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

            const save = new Promise<void>((resolve, reject) => {
              ws.on('finish', resolve);
              ws.on('error', reject);
              fileStream.on('error', reject);
            });
            // 中断・切断時の未処理 rejection（プロセスごと落とし得る）を防ぐ。
            // 正常系では下の Promise.all(saves) が同じ rejection を検知する。
            save.catch(() => {});
            saves.push(save);
        });
        bb.on('error', reject);
        bb.on('close', resolve);
    });

    // Next.js(undici) の req.body(Web ReadableStream) を busboy へ手動で流し込む。
    // Readable.fromWeb().pipe(bb) ではストリーム終端の伝播が不安定で、全バイトが
    // 届く前に終端し busboy が "Unexpected end of form" を投げることがあるため、
    // getReader() で最後まで読み切ってから明示的に bb.end() する。
    const pump = (async () => {
        const reader = (req.body as ReadableStream<Uint8Array>).getReader();
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value && value.byteLength) {
                    // バックプレッシャを尊重し、書き込みが詰まったら drain を待つ。
                    if (!bb.write(Buffer.from(value))) {
                        await new Promise<void>((res) => bb.once('drain', res));
                    }
                }
            }
            bb.end();
        } catch (err) {
            bb.destroy(err as Error);
            throw err;
        }
    })();

    try {
        await Promise.all([finished, pump]);
        await Promise.all(saves);
    } catch (err: any) {
        const message = err?.message || 'failed to receive upload';
        jobStore.set(jobId, { status: 'error', error: message });
        bus.emitEvent({ type: 'error', message });
        try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
        return new Response(JSON.stringify({ error: message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (files.length === 0) {
        try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
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
