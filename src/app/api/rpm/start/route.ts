import { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { jobStore } from '@/lib/jobStore';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { buildRpmBundle, normalizeRpmBaseUrl, RPM_REPO_PRESETS, type RpmRepository } from '@/lib/rpm/downloader';
import { makeArtifactObjectKey, uploadFileToS3 } from '@/lib/storage/s3';
import { logRequest } from '@/lib/requestLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function normalizeCustomRepositories(input: unknown): RpmRepository[] {
    if (!Array.isArray(input)) return [];
    const customRepos: RpmRepository[] = [];
    for (let i = 0; i < input.length; i += 1) {
        const entry = input[i] as Record<string, unknown>;
        const baseUrlRaw = typeof entry?.baseUrl === 'string' ? entry.baseUrl.trim() : '';
        if (!baseUrlRaw) continue;
        let baseUrl: string;
        try { baseUrl = normalizeRpmBaseUrl(baseUrlRaw); }
        catch (error) {
            throw new Error(`customRepositories[${i}] ${(error as Error).message}`);
        }

        const idRaw = typeof entry?.id === 'string' ? entry.id.trim() : '';
        const labelRaw = typeof entry?.label === 'string' ? entry.label.trim() : '';
        const folderRaw = typeof entry?.folderName === 'string' ? entry.folderName.trim() : '';
        const gpgKeyUrl = typeof entry?.gpgKeyUrl === 'string' ? entry.gpgKeyUrl.trim() : '';
        const generated = `custom-repo-${i + 1}`;
        const id = idRaw || generated;
        if (!/^[A-Za-z0-9_.:-]+$/.test(id)) {
            throw new Error(`customRepositories[${i}] id contains unsupported characters`);
        }
        let parsedGpgKeyUrl: URL;
        try {
            parsedGpgKeyUrl = new URL(gpgKeyUrl);
        } catch {
            throw new Error(`customRepositories[${i}] gpgKeyUrl is invalid`);
        }
        if (parsedGpgKeyUrl.protocol !== 'https:' || parsedGpgKeyUrl.username || parsedGpgKeyUrl.password || parsedGpgKeyUrl.search || parsedGpgKeyUrl.hash) {
            throw new Error(`customRepositories[${i}] gpgKeyUrl must be a public HTTPS URL without credentials or query parameters`);
        }
        customRepos.push({
            id,
            label: labelRaw || idRaw || generated,
            folderName: folderRaw || labelRaw || idRaw || generated,
            baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
            gpgKeyUrl,
        });
    }
    return customRepos;
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const packages = Array.isArray(body.packages) ? body.packages.map((s: any) => String(s).trim()).filter(Boolean) : [];
    const bundleName = typeof body.bundleName === 'string' && body.bundleName.trim() ? body.bundleName.trim() : 'rpm-offline';
    const repositoryIds = Array.isArray(body.repositories) ? body.repositories.map((s: any) => String(s).trim()).filter(Boolean) : [];
    const resolveDependencies = body.resolveDependencies !== false;
    // プライベートリポジトリ用の認証情報（任意）。カスタムリポジトリにのみ付与する
    // （プリセットは公開ミラーのため資格情報は不要）。
    const username = typeof body.username === 'string' && body.username.trim() ? body.username.trim() : undefined;
    const password = typeof body.password === 'string' && body.password ? body.password : undefined;

    if (!packages.length) {
        return new Response(JSON.stringify({ error: 'packages[] is required' }), { status: 400 });
    }

    let repositories: RpmRepository[];
    try {
        const presetRepos = RPM_REPO_PRESETS.filter((repo) => repositoryIds.includes(repo.id));
        const normalizedCustomRepos = normalizeCustomRepositories(body.customRepositories);
        if ((username || password) && new Set(normalizedCustomRepos.map((repo) => new URL(repo.baseUrl).origin)).size > 1) {
            throw new Error('one RPM credential set cannot be sent to custom repositories on multiple origins; use separate jobs');
        }
        const customRepos = normalizedCustomRepos.map((repo) => (
            (username || password) ? { ...repo, username, password } : repo
        ));
        const usedIds = new Set<string>();
        repositories = [...presetRepos, ...customRepos].map((repo) => {
            let nextId = repo.id;
            let suffix = 2;
            while (usedIds.has(nextId)) {
                nextId = `${repo.id}-${suffix}`;
                suffix += 1;
            }
            usedIds.add(nextId);
            return { ...repo, id: nextId };
        });
    } catch (err: any) {
        return new Response(JSON.stringify({ error: err?.message || 'invalid customRepositories' }), { status: 400 });
    }

    if (!repositories.length) {
        return new Response(JSON.stringify({ error: 'at least one repository is required' }), { status: 400 });
    }

    const jobId = nanoid();
    const bus = new ProgressBus();
    if (!jobStore.create(jobId)) return Response.json({ error: 'job capacity exceeded' }, { status: 503 });
    globalBusMap.set(jobId, bus);
    bus.emitEvent({ type: 'stage', stage: 'queued' });
    bus.emitEvent({ type: 'log', level: 'info', message: `ジョブを受け付けました: ${jobId}` });

    logRequest(req, `rpm:start job=${jobId}`);

    (async () => {
        let workRoot: string | undefined;
        try {
            jobStore.set(jobId, { status: 'running' });
            bus.emitEvent({ type: 'log', level: 'info', message: `開始パッケージ: ${packages.join(', ')}` });
            const { tarPath, filename, workRoot: root } = await buildRpmBundle({
                specs: packages,
                bundleName,
                repositories,
                resolveDependencies,
                bus,
            });
            workRoot = root;
            const objectKey = makeArtifactObjectKey(jobId, filename);
            bus.emitEvent({ type: 'stage', stage: 'uploading-s3' });
            bus.emitEvent({ type: 'log', level: 'info', message: 'S3へアップロード中です。' });
            await uploadFileToS3({ filePath: tarPath, key: objectKey, contentType: 'application/x-tar' });
            jobStore.set(jobId, { status: 'done', filename, objectKey });
            bus.emitEvent({ type: 'log', level: 'info', message: 'RPMバンドルの生成が完了しました。' });
            bus.emitEvent({ type: 'done', filename });
        } catch (err: any) {
            jobStore.set(jobId, { status: 'error', error: err?.message || 'failed' });
            bus.emitEvent({ type: 'error', message: err?.message || 'failed' });
        } finally {
            if (workRoot) {
                try { await fs.rm(workRoot, { recursive: true, force: true }); } catch {}
            }
        }
    })();

    return new Response(JSON.stringify({ jobId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
