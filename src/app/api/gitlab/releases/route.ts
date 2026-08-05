import { NextRequest } from 'next/server';
import { listGitLabReleases } from '@/lib/gitlab/downloader';
import { logRequest } from '@/lib/requestLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const project = typeof body?.project === 'string' ? body.project.trim() : '';
    const requestToken = typeof body?.token === 'string' ? body.token.trim() : '';
    const baseUrl = process.env.GITLAB_BASE_URL?.trim() || '';

    if (!baseUrl) return Response.json({ error: 'GITLAB_BASE_URLが設定されていません' }, { status: 503 });
    if (!project) return Response.json({ error: 'プロジェクトIDまたはパスを入力してください' }, { status: 400 });
    if (project.length > 500 || requestToken.length > 4096) {
        return Response.json({ error: '入力値が長すぎます' }, { status: 400 });
    }

    logRequest(req, 'gitlab:releases:list');
    try {
        const releases = await listGitLabReleases({
            baseUrl,
            project,
            token: requestToken || process.env.GITLAB_TOKEN,
        });
        return Response.json({ releases });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'GitLabリリース候補の取得に失敗しました';
        return Response.json({ error: message }, { status: 502 });
    }
}
