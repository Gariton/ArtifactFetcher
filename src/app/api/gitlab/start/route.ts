import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { jobStore } from '@/lib/jobStore';
import { downloadGitLabArchive } from '@/lib/gitlab/downloader';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { logRequest } from '@/lib/requestLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const project = typeof body?.project === 'string' ? body.project.trim() : '';
    const ref = typeof body?.ref === 'string' ? body.ref.trim() : '';
    const requestToken = typeof body?.token === 'string' ? body.token.trim() : '';
    const baseUrl = process.env.GITLAB_BASE_URL?.trim() || '';

    if (!baseUrl) {
        return Response.json({ error: 'GITLAB_BASE_URLが設定されていません' }, { status: 503 });
    }
    if (!project) {
        return Response.json({ error: 'プロジェクトIDまたはパスを入力してください' }, { status: 400 });
    }
    if (project.length > 500 || ref.length > 255 || requestToken.length > 4096) {
        return Response.json({ error: '入力値が長すぎます' }, { status: 400 });
    }

    logRequest(req, 'gitlab:start');
    const jobId = nanoid();
    const objectKey = `${jobId}/gitlab-repository.zip`;
    const bus = new ProgressBus();
    jobStore.set(jobId, { status: 'queued' });
    globalBusMap.set(jobId, bus);
    bus.emitEvent({ type: 'stage', stage: 'queued' });

    void (async () => {
        try {
            jobStore.set(jobId, { status: 'running' });
            const { filename } = await downloadGitLabArchive({
                baseUrl,
                project,
                ref: ref || undefined,
                token: requestToken || process.env.GITLAB_TOKEN,
                objectKey,
                bus,
            });
            jobStore.set(jobId, { status: 'done', filename, objectKey });
            bus.emitEvent({ type: 'done', filename });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'GitLabからの取得に失敗しました';
            jobStore.set(jobId, { status: 'error', error: message });
            bus.emitEvent({ type: 'error', message });
        }
    })();

    return Response.json({ jobId });
}
