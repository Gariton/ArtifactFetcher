import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import fs from 'node:fs/promises';
import { jobStore } from "@/lib/jobStore";
import { ProgressBus, globalBusMap } from "@/lib/progressBus";
import { buildDockerImageTar } from "@/lib/docker/downloader";
import { logRequest } from "@/lib/requestLog";
import { uploadFileToS3 } from "@/lib/storage/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
    const { repo, tag, platform } = await req.json();
    if (!repo || !tag) return new Response(JSON.stringify({error: 'Missing repo or tag'}), {status: 400});

    logRequest(req, `docker:start ${repo}:${tag} platform=${platform || 'linux/amd64'}`);

    const jobId = nanoid();
    jobStore.set(jobId, { status: 'queued' });

    // 進捗用バス
    const bus = new ProgressBus();
    globalBusMap.set(jobId, bus);

    // 非同期でビルド開始
    (async () => {
        try {
            jobStore.set(jobId, { status: 'running' });
            let workRoot: string | undefined;
            try {
                const { tarPath, filename, workRoot: tmpRoot } = await buildDockerImageTar({ repository: repo, tag, platform: platform || 'linux/amd64', bus });
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
