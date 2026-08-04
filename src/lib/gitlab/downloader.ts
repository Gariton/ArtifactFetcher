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

type DownloadGitLabReleaseAssetOptions = {
    baseUrl: string;
    project: string;
    releaseTag: string;
    assetName: string;
    token?: string;
    objectKey: string;
    bus: ProgressBus;
};

type GitLabRelease = {
    tag_name?: string;
    assets?: {
        links?: Array<{
            name?: string;
            url?: string;
            direct_asset_url?: string;
        }>;
    };
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
    if (status === 404) return new Error('GitLabプロジェクト、ref、またはリリースファイルが見つかりません');
    if (status) return new Error(`GitLab APIがエラーを返しました (${status})`);
    return new Error(`GitLabへ接続できません (${error.code || 'network error'})`);
}

function apiUrl(gitlab: URL, path: string): URL {
    const basePath = gitlab.pathname === '/' ? '' : gitlab.pathname;
    const url = new URL(`${basePath}/api/v4/${path}`, gitlab.origin);
    if (url.origin !== gitlab.origin) throw new Error('GitLab API URLが不正です');
    return url;
}

function authHeaders(token?: string): Record<string, string> | undefined {
    return token?.trim() ? { 'PRIVATE-TOKEN': token.trim() } : undefined;
}

async function streamToS3({
    url,
    token,
    objectKey,
    contentType,
    itemName,
    bus,
}: {
    url: URL;
    token?: string;
    objectKey: string;
    contentType?: string;
    itemName: string;
    bus: ProgressBus;
}): Promise<{ size: number; contentType?: string }> {
    const response = await axios.get(url.toString(), {
        responseType: 'stream',
        timeout: 300_000,
        maxRedirects: 0,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: authHeaders(token),
        validateStatus: (status) => status >= 200 && status < 300,
    });
    const total = Number.parseInt(response.headers['content-length'] || '', 10) || undefined;
    bus.emitEvent({ type: 'item-start', index: 0, digest: itemName, total });

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

    const responseContentType = typeof response.headers['content-type'] === 'string'
        ? response.headers['content-type']
        : undefined;
    await uploadStreamToS3({
        stream: uploadStream,
        key: objectKey,
        contentType: responseContentType || contentType || 'application/octet-stream',
    });
    bus.emitEvent({ type: 'item-done', index: 0 });
    return { size: received, contentType: responseContentType };
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
    const archiveUrl = apiUrl(gitlab, `projects/${encodeURIComponent(normalizedProject)}/repository/archive.zip`);
    if (normalizedRef) archiveUrl.searchParams.set('sha', normalizedRef);

    const filename = `${safeFilenamePart(normalizedProject.replaceAll('/', '-'))}-${safeFilenamePart(normalizedRef || 'default')}.zip`;
    bus.emitEvent({
        type: 'manifest-resolved',
        items: [{ name: normalizedProject, ref: normalizedRef || 'default branch' }],
    });
    bus.emitEvent({ type: 'stage', stage: 'downloading-gitlab-archive' });

    try {
        const { size } = await streamToS3({
            url: archiveUrl,
            token,
            objectKey,
            contentType: 'application/zip',
            itemName: normalizedProject,
            bus,
        });
        return { filename, size };
    } catch (error) {
        throw gitLabError(error);
    }
}

export async function downloadGitLabReleaseAsset({
    baseUrl,
    project,
    releaseTag,
    assetName,
    token,
    objectKey,
    bus,
}: DownloadGitLabReleaseAssetOptions): Promise<{ filename: string; size: number }> {
    const gitlab = normalizeBaseUrl(baseUrl);
    const normalizedProject = normalizeProject(project);
    const normalizedTag = releaseTag.trim();
    const normalizedAssetName = assetName.trim();
    if (!normalizedTag) throw new Error('リリースタグを入力してください');
    if (!normalizedAssetName) throw new Error('リリースファイル名を入力してください');

    const releaseUrl = apiUrl(
        gitlab,
        `projects/${encodeURIComponent(normalizedProject)}/releases/${encodeURIComponent(normalizedTag)}`,
    );

    try {
        bus.emitEvent({ type: 'stage', stage: 'resolving-gitlab-release' });
        const releaseResponse = await axios.get<GitLabRelease>(releaseUrl.toString(), {
            timeout: 30_000,
            maxRedirects: 0,
            headers: authHeaders(token),
            validateStatus: (status) => status >= 200 && status < 300,
        });
        const links = releaseResponse.data.assets?.links || [];
        const asset = links.find((link) => link.name === normalizedAssetName);
        if (!asset) {
            const available = links.flatMap((link) => link.name ? [link.name] : []).slice(0, 10);
            const suffix = available.length ? `（利用可能: ${available.join(', ')}）` : '（リンクされたアセットがありません）';
            throw new Error(`リリースファイル「${normalizedAssetName}」が見つかりません${suffix}`);
        }

        // direct_asset_url is a friendly GitLab URL that normally redirects to url.
        // Use the actual URL so downloads work with redirects disabled and credentials
        // can never be forwarded to a different host.
        const rawAssetUrl = asset.url || asset.direct_asset_url;
        if (!rawAssetUrl) throw new Error('リリースファイルのURLがありません');
        const assetUrl = new URL(rawAssetUrl, gitlab.origin);
        if (assetUrl.origin !== gitlab.origin || !['http:', 'https:'].includes(assetUrl.protocol)) {
            throw new Error('外部ホストのリリースファイルはダウンロードできません');
        }

        const filename = safeFilenamePart(normalizedAssetName);
        bus.emitEvent({
            type: 'manifest-resolved',
            items: [{
                name: normalizedAssetName,
                ref: releaseResponse.data.tag_name || normalizedTag,
                kind: 'release-asset',
                project: normalizedProject,
            }],
        });
        bus.emitEvent({ type: 'stage', stage: 'downloading-gitlab-release-asset' });
        const { size } = await streamToS3({
            url: assetUrl,
            token,
            objectKey,
            itemName: normalizedAssetName,
            bus,
        });
        return { filename, size };
    } catch (error) {
        throw gitLabError(error);
    }
}
