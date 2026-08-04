import axios, { AxiosError, type AxiosResponse } from 'axios';
import { PassThrough, Readable, Transform } from 'node:stream';
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

export type GitLabReleaseAssetOption = {
    name: string;
    fileName: string;
    directAssetUrl: string;
    linkType?: string;
};

export type GitLabReleaseOption = {
    tagName: string;
    name?: string;
    releasedAt?: string;
    assets: GitLabReleaseAssetOption[];
};

type GitLabReleaseResponse = {
    tag_name?: string;
    name?: string;
    released_at?: string;
    assets?: {
        links?: Array<{
            name?: string;
            direct_asset_url?: string;
            link_type?: string;
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
    if (!project) throw new Error('プロジェクトIDまたはパスが不正です');
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
    if (status === 404) return new Error('GitLabプロジェクト、ref、リリース、またはアセットが見つかりません');
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

function filenameFromAssetUrl(url: string, fallback: string): string {
    try {
        const pathname = new URL(url).pathname;
        const basename = pathname.split('/').filter(Boolean).at(-1);
        return basename ? decodeURIComponent(basename) : fallback;
    } catch {
        return fallback;
    }
}

function normalizeRelease(release: GitLabReleaseResponse, gitlab: URL): GitLabReleaseOption | null {
    if (!release.tag_name) return null;
    const assets = (release.assets?.links || []).flatMap((asset) => {
        if (!asset.name || !asset.direct_asset_url) return [];
        try {
            const directUrl = new URL(asset.direct_asset_url, gitlab.origin);
            if (!['http:', 'https:'].includes(directUrl.protocol) || directUrl.origin !== gitlab.origin) return [];
            return [{
                name: asset.name,
                fileName: filenameFromAssetUrl(directUrl.toString(), asset.name),
                directAssetUrl: directUrl.toString(),
                linkType: asset.link_type,
            }];
        } catch {
            return [];
        }
    });
    return {
        tagName: release.tag_name,
        name: release.name,
        releasedAt: release.released_at,
        assets,
    };
}

async function streamToS3({
    url,
    token,
    objectKey,
    contentType,
    itemName,
    bus,
    allowExternalRedirect = false,
}: {
    url: URL;
    token?: string;
    objectKey: string;
    contentType?: string;
    itemName: string;
    bus: ProgressBus;
    allowExternalRedirect?: boolean;
}): Promise<{ size: number; contentType?: string }> {
    let currentUrl = url;
    let response: AxiosResponse<Readable> | undefined;
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
        response = await axios.get<Readable>(currentUrl.toString(), {
            responseType: 'stream',
            timeout: 300_000,
            maxRedirects: 0,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: currentUrl.origin === url.origin ? authHeaders(token) : undefined,
            validateStatus: (status) => (status >= 200 && status < 300) || [301, 302, 303, 307, 308].includes(status),
        });
        if (response.status >= 200 && response.status < 300) break;

        const location = response.headers.location;
        response.data.destroy();
        if (!location) throw new Error('GitLabのダウンロード先リダイレクトが不正です');
        const nextUrl = new URL(location, currentUrl);
        if (!['http:', 'https:'].includes(nextUrl.protocol)) {
            throw new Error('GitLabのダウンロード先URLが不正です');
        }
        if (!allowExternalRedirect && nextUrl.origin !== url.origin) {
            throw new Error('外部ホストへのリダイレクトは許可されていません');
        }
        currentUrl = nextUrl;
        response = undefined;
    }
    if (!response || response.status < 200 || response.status >= 300) {
        throw new Error('GitLabのダウンロードでリダイレクト回数を超えました');
    }

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

export async function listGitLabReleases({
    baseUrl,
    project,
    token,
}: {
    baseUrl: string;
    project: string;
    token?: string;
}): Promise<GitLabReleaseOption[]> {
    const gitlab = normalizeBaseUrl(baseUrl);
    const normalizedProject = normalizeProject(project);
    const url = apiUrl(gitlab, `projects/${encodeURIComponent(normalizedProject)}/releases`);
    url.searchParams.set('order_by', 'released_at');
    url.searchParams.set('sort', 'desc');
    url.searchParams.set('per_page', '100');
    try {
        const response = await axios.get<GitLabReleaseResponse[]>(url.toString(), {
            timeout: 30_000,
            maxRedirects: 0,
            headers: authHeaders(token),
            validateStatus: (status) => status >= 200 && status < 300,
        });
        return response.data.flatMap((release) => {
            const normalized = normalizeRelease(release, gitlab);
            return normalized && normalized.assets.length > 0 ? [normalized] : [];
        });
    } catch (error) {
        throw gitLabError(error);
    }
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
    if (!normalizedTag) throw new Error('リリースタグを選択してください');
    if (!normalizedAssetName) throw new Error('リリースアセットを選択してください');

    const releaseUrl = apiUrl(
        gitlab,
        `projects/${encodeURIComponent(normalizedProject)}/releases/${encodeURIComponent(normalizedTag)}`,
    );
    try {
        bus.emitEvent({ type: 'stage', stage: 'resolving-gitlab-release' });
        const response = await axios.get<GitLabReleaseResponse>(releaseUrl.toString(), {
            timeout: 30_000,
            maxRedirects: 0,
            headers: authHeaders(token),
            validateStatus: (status) => status >= 200 && status < 300,
        });
        const release = normalizeRelease(response.data, gitlab);
        const asset = release?.assets.find((item) => item.name === normalizedAssetName);
        if (!asset) {
            const available = release?.assets.map((item) => item.name).slice(0, 10) || [];
            const suffix = available.length ? `（利用可能: ${available.join(', ')}）` : '';
            throw new Error(`リリースアセット「${normalizedAssetName}」が見つかりません${suffix}`);
        }

        const assetUrl = new URL(asset.directAssetUrl);
        const filename = safeFilenamePart(asset.fileName);
        bus.emitEvent({
            type: 'manifest-resolved',
            items: [{
                name: asset.fileName,
                ref: release?.tagName || normalizedTag,
                kind: 'release-asset',
                project: normalizedProject,
            }],
        });
        bus.emitEvent({ type: 'stage', stage: 'downloading-gitlab-release-asset' });
        const { size } = await streamToS3({
            url: assetUrl,
            token,
            objectKey,
            itemName: asset.fileName,
            bus,
            allowExternalRedirect: true,
        });
        return { filename, size };
    } catch (error) {
        throw gitLabError(error);
    }
}
