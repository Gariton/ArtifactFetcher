import { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { buildPipBundle } from '@/lib/pip/downloader';
import { uploadFileToS3 } from '@/lib/storage/s3';
import { logRequest } from '@/lib/requestLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// index URL に Basic 認証情報を埋め込む（pip は URL 内の userinfo を認証に使う）。
// ユーザー名が無くトークンのみの場合は PyPI 慣習に倣い __token__ を使う。
function injectCredentials(rawUrl: string, username?: string, password?: string): string {
    if (!username && !password) return rawUrl;
    try {
        const u = new URL(rawUrl);
        u.username = username || (password ? '__token__' : '');
        u.password = password || '';
        return u.toString();
    } catch {
        return rawUrl;
    }
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const packages = Array.isArray(body.packages) ? (body.packages as string[]).map((s) => String(s).trim()).filter(Boolean) : undefined;
    const requirementsText = typeof body.requirementsText === 'string' ? body.requirementsText : undefined;
    const bundleName = typeof body.bundleName === 'string' && body.bundleName.trim() ? body.bundleName.trim() : 'pip-offline';
    const indexUrl = typeof body.indexUrl === 'string' && body.indexUrl.trim() ? body.indexUrl.trim() : undefined;
    const extraIndexUrls = Array.isArray(body.extraIndexUrls) ? body.extraIndexUrls.map((url: any) => String(url).trim()).filter(Boolean) : [];
    const trustedHosts = Array.isArray(body.trustedHosts) ? body.trustedHosts.map((h: any) => String(h).trim()).filter(Boolean) : [];
    const username = typeof body.username === 'string' && body.username.trim() ? body.username.trim() : undefined;
    const password = typeof body.password === 'string' && body.password ? body.password : undefined;

    if ((!packages || packages.length === 0) && !requirementsText) {
        return new Response(JSON.stringify({ error: 'packages[] or requirementsText is required' }), { status: 400 });
    }

    const jobId = nanoid();
    const bus = new ProgressBus();
    jobStore.set(jobId, { status: 'queued' });
    globalBusMap.set(jobId, bus);
    bus.emitEvent({ type: 'stage', stage: 'queued' });

    logRequest(req, `pip:start job=${jobId}`);

    (async () => {
        let workRoot: string | undefined;
        try {
            jobStore.set(jobId, { status: 'running' });
            const pipArgs: string[] = [];
            if (indexUrl) pipArgs.push('--index-url', injectCredentials(indexUrl, username, password));
            if (extraIndexUrls.length) {
                for (const url of extraIndexUrls) pipArgs.push('--extra-index-url', injectCredentials(url, username, password));
            }
            if (trustedHosts.length) {
                for (const host of trustedHosts) pipArgs.push('--trusted-host', host);
            }

            const { tarPath, filename, workRoot: root } = await buildPipBundle({
                specs: packages,
                requirementsText,
                bundleName,
                pipArgs,
                bus,
            });
            workRoot = root;
            const objectKey = `${jobId}/${filename}`;
            bus.emitEvent({ type: 'stage', stage: 'uploading-s3' });
            await uploadFileToS3({ filePath: tarPath, key: objectKey, contentType: 'application/x-tar' });
            jobStore.set(jobId, { status: 'done', filename, objectKey });
        } catch (err: any) {
            jobStore.set(jobId, { status: 'error', error: err?.message || 'failed' });
            bus.emitEvent({ type: 'error', message: err?.message || 'failed' });
        } finally {
            if (workRoot) {
                try { await fs.rm(workRoot, { recursive: true, force: true }); } catch {}
            }
        }
    })();

    return new Response(JSON.stringify({ jobId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
