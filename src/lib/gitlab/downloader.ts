import axios, { AxiosError } from 'axios';
import { PassThrough, Transform } from 'node:stream';
import { ProgressBus } from '@/lib/progressBus';
import { uploadStreamToS3 } from '@/lib/storage/s3';

type DownloadGitLabArchiveOptions = {
    baseUrl: string;
    project: string;
    ref?: string;
    token?: string;
    objectKey: string;
    bus: ProgressBus;
};

function normalizeBaseUrl(value: string): URL {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('GITLAB_BASE_URL must use http or https');
    }
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url;
}

function normalizeProject(value: string): string {
    const project = value.trim().replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    if (!project) {
        throw new Error('プロジェクトIDまたはパスが不正です');
    }
    return project;
}

function safeFilenamePart(value: string): string {
    return value
        .normalize('NFKC')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100) || 'repository';
}

function gitLabError(error: unknown): Error {
    if (!(error instanceof AxiosError)) {
        return error instanceof Error ? error : new Error('GitLabからの取得に失敗しました');
    }
    const status = error.response?.status;
    if (status === 401 || status === 403) return new Error('GitLabの認証またはアクセス権限を確認してください');
    if (status === 404) return new Error('GitLabプロジェクトまたはrefが見つかりません');
    if (status) return new Error(`GitLab APIがエラーを返しました (${status})`);
    return new Error(`GitLabへ接続できません (${error.code || 'network error'})`);
}

export async function downloadGitLabArchive({
    baseUrl,
    project,
    ref,
    token,
    objectKey,
    bus,
}: DownloadGitLabArchiveOptions): Promise<{ filename: string; size: number }> {
    const gitlab = normalizeBaseUrl(baseUrl);
    const normalizedProject = normalizeProject(project);
    const normalizedRef = ref?.trim() || '';
    const basePath = gitlab.pathname === '/' ? '' : gitlab.pathname;
    const apiPath = `${basePath}/api/v4/projects/${encodeURIComponent(normalizedProject)}/repository/archive.zip`;
    const archiveUrl = new URL(apiPath, gitlab.origin);
    if (archiveUrl.origin !== gitlab.origin) throw new Error('GitLab API URLが不正です');
    if (normalizedRef) archiveUrl.searchParams.set('sha', normalizedRef);

    const filename = `${safeFilenamePart(normalizedProject.replaceAll('/', '-'))}-${safeFilenamePart(normalizedRef || 'default')}.zip`;
    bus.emitEvent({
        type: 'manifest-resolved',
        items: [{ name: normalizedProject, ref: normalizedRef || 'default branch' }],
    });
    bus.emitEvent({ type: 'stage', stage: 'downloading-gitlab-archive' });

    try {
        const response = await axios.get(archiveUrl.toString(), {
            responseType: 'stream',
            timeout: 300_000,
            maxRedirects: 0,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: token?.trim() ? { 'PRIVATE-TOKEN': token.trim() } : undefined,
            validateStatus: (status) => status >= 200 && status < 300,
        });
        const total = Number.parseInt(response.headers['content-length'] || '', 10) || undefined;
        bus.emitEvent({ type: 'item-start', index: 0, digest: normalizedProject, total });

        let received = 0;
        const progress = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                received += chunk.length;
                bus.emitEvent({ type: 'item-progress', index: 0, received, total });
                callback(null, chunk);
            },
        });
        const uploadStream = new PassThrough();
        response.data.pipe(progress).pipe(uploadStream);

        await uploadStreamToS3({
            stream: uploadStream,
            key: objectKey,
            contentType: 'application/zip',
        });
        bus.emitEvent({ type: 'item-done', index: 0 });
        return { filename, size: received };
    } catch (error) {
        throw gitLabError(error);
    }
}
