import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import fs from 'node:fs/promises';
import { jobStore } from "@/lib/jobStore";
import { ProgressBus, globalBusMap } from "@/lib/progressBus";
import { buildDockerImageTar } from "@/lib/docker/downloader";
import { logRequest } from "@/lib/requestLog";
import { makeArtifactObjectKey, uploadFileToS3 } from "@/lib/storage/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
    const { repo, tag, platform, registry, username, password, insecureTLS } = await req.json();
    if (!repo || !tag) return new Response(JSON.stringify({error: 'Missing repo or tag'}), {status: 400});

    // 認証情報はリクエストボディ（JSON）でのみ受け取り、ログには残さない。
    logRequest(req, `docker:start ${registry ? registry + '/' : ''}${repo}:${tag} platform=${platform || 'linux/amd64'}`);

    const jobId = nanoid();
    if (!jobStore.create(jobId)) return Response.json({ error: 'job capacity exceeded' }, { status: 503 });

    // 進捗用バス
    const bus = new ProgressBus();
    globalBusMap.set(jobId, bus);

    // 非同期でビルド開始
    (async () => {
        try {
            jobStore.set(jobId, { status: 'running' });
            let workRoot: string | undefined;
            try {
                const { tarPath, filename, workRoot: tmpRoot } = await buildDockerImageTar({
                    repository: repo,
                    tag,
                    platform: platform || 'linux/amd64',
                    registry: registry || undefined,
                    username: username || undefined,
                    password: password || undefined,
                    insecureTLS: Boolean(insecureTLS),
                    bus,
                });
                workRoot = tmpRoot;
                const objectKey = makeArtifactObjectKey(jobId, filename);
                bus.emitEvent({ type: 'stage', stage: 'uploading-s3' });
                await uploadFileToS3({ filePath: tarPath, key: objectKey, contentType: 'application/x-tar' });
                jobStore.set(jobId, { status: 'done', filename, objectKey });
                bus.emitEvent({ type: 'done', filename });
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
