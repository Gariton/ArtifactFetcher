import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { jobStore } from '@/lib/jobStore';
import {
    downloadGitLabArchive,
    downloadGitLabReleaseAssets,
} from '@/lib/gitlab/downloader';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { logRequest } from '@/lib/requestLog';
import { makeArtifactObjectKey } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const project = typeof body?.project === 'string' ? body.project.trim() : '';
    const ref = typeof body?.ref === 'string' ? body.ref.trim() : '';
    const target = body?.target === 'release-asset' ? 'release-asset' : 'archive';
    const releaseTag = typeof body?.releaseTag === 'string' ? body.releaseTag.trim() : '';
    const assetNames: string[] = Array.isArray(body?.assetNames)
        ? body.assetNames.filter((name: unknown): name is string => typeof name === 'string').map((name: string) => name.trim()).filter(Boolean)
        : typeof body?.assetName === 'string' && body.assetName.trim()
            ? [body.assetName.trim()]
            : [];
    const requestToken = typeof body?.token === 'string' ? body.token.trim() : '';
    const baseUrl = process.env.GITLAB_BASE_URL?.trim() || '';

    if (!baseUrl) {
        return Response.json({ error: 'GITLAB_BASE_URLが設定されていません' }, { status: 503 });
    }
    if (!project) {
        return Response.json({ error: 'プロジェクトIDまたはパスを入力してください' }, { status: 400 });
    }
    if (target === 'release-asset' && (!releaseTag || !assetNames.length)) {
        return Response.json({ error: 'リリースタグとアセットを選択してください' }, { status: 400 });
    }
    if (assetNames.length > 50) return Response.json({ error: '一度に選択できるアセットは50件までです' }, { status: 400 });
    if (
        project.length > 500
        || ref.length > 255
        || releaseTag.length > 255
        || assetNames.some((name) => name.length > 500)
        || requestToken.length > 4096
    ) {
        return Response.json({ error: '入力値が長すぎます' }, { status: 400 });
    }

    logRequest(req, 'gitlab:start');
    const jobId = nanoid();
    const objectKey = makeArtifactObjectKey(jobId, target === 'archive'
        ? 'gitlab-repository.zip'
        : assetNames.length > 1
            ? 'gitlab-release-assets.tar'
            : 'gitlab-release-asset');
    const bus = new ProgressBus();
    if (!jobStore.create(jobId)) return Response.json({ error: 'job capacity exceeded' }, { status: 503 });
    globalBusMap.set(jobId, bus);
    bus.emitEvent({ type: 'stage', stage: 'queued' });

    void (async () => {
        try {
            jobStore.set(jobId, { status: 'running' });
            const common = {
                baseUrl,
                project,
                token: requestToken || process.env.GITLAB_TOKEN,
                objectKey,
                bus,
            };
            const { filename } = target === 'release-asset'
                ? await downloadGitLabReleaseAssets({ ...common, releaseTag, assetNames })
                : await downloadGitLabArchive({ ...common, ref: ref || undefined });
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
