import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { jobStore } from "@/lib/jobStore";
import { ProgressBus, globalBusMap } from "@/lib/progressBus";
import { buildDockerImageTar } from "@/lib/docker/downloader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
    const { repo, tag, platform } = await req.json();
    if (!repo || !tag) return new Response(JSON.stringify({error: 'Missing repo or tag'}), {status: 400});

    const jobId = nanoid();
    jobStore.set(jobId, { status: 'queued' });

    // 進捗用バス
    const bus = new ProgressBus();
    globalBusMap.set(jobId, bus);

    // 非同期でビルド開始
    (async () => {
        try {
            jobStore.set(jobId, { status: 'running' });
            const { tarPath, filename } = await buildDockerImageTar({ repository: repo, tag, platform: platform || 'linux/amd64', bus });
            jobStore.set(jobId, { status: 'done', tarPath, filename });
        } catch (e: any) {
            jobStore.set(jobId, { status: 'error', error: e?.message || 'failed' });
            bus.emitEvent({ type: 'error', message: e?.message || 'failed' });
        }
    })();

    return new Response(JSON.stringify({ jobId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}