import axios from 'axios';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as ssri from 'ssri';
import { parseLockfile } from './lockParser';
import { ProgressBus, type LockEntry } from '../progressBus';
import type { NpmAuth } from './arboristLock';
import { safeBundleName, safeFilenamePart } from '@/lib/inputSafety';
import { assertFileSize, assertItemCount, ByteBudget } from '@/lib/resourceLimits';

// tarball ダウンロード用の Authorization ヘッダを組み立てる。
// username があれば Basic、なければトークン(secret)として Bearer。
function buildNpmAuthHeader(auth?: NpmAuth): Record<string, string> {
    if (!auth) return {};
    const token = auth.token?.trim();
    const username = auth.username?.trim();
    const secret = auth.password ?? '';
    if (username) {
        return { Authorization: `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}` };
    }
    if (token) return { Authorization: `Bearer ${token}` };
    if (secret) return { Authorization: `Bearer ${secret}` };
    return {};
}

function sameOrigin(a: string, b: string): boolean {
    try { return new URL(a).origin === new URL(b).origin; }
    catch { return false; }
}

async function requestWithRetry(config: any, retries = 5, baseDelayMs = 500) {
    let attempt = 0;
    while (true) {
        try { return await axios.request({ timeout: 60_000, ...config }); }
        catch (err: any) {
            attempt += 1;
            const status = err?.response?.status;
            const retriable = err?.code === 'ECONNABORTED' || err?.code === 'ECONNRESET' || status === 429 || (status >= 500 && status < 600);
            if (!retriable || attempt > retries) throw err;
            const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

export async function buildTarFromLock({
    lockText,
    bus,
    bundleName = 'npm-offline',
    registry,
    auth,
}: {
    lockText: string;
    bus: ProgressBus;
    bundleName?: string;
    registry?: string;
    auth?: NpmAuth;
}) {
    const resolvedBundleName = safeBundleName(bundleName, 'npm-offline');
    bus.emitEvent({ type: 'stage', stage: 'parse-lockfile' });
    let entries: LockEntry[] = parseLockfile(lockText);
    entries = entries.filter(e => !!e.resolved);
    assertItemCount(entries.length, 'npm package');
    const missingIntegrity = entries.find((entry) => !entry.integrity);
    if (missingIntegrity) {
        throw new Error(`lockfile entry ${missingIntegrity.name}@${missingIntegrity.version} is missing integrity metadata`);
    }
    bus.emitEvent({ type: 'manifest-resolved', items: entries });

    // レジストリと同一ホストの tarball にのみ認証ヘッダを付与する。
    // （public な tarball 配信元へ資格情報を漏らさないため）
    const authHeader = buildNpmAuthHeader(auth);
    if (registry && Object.keys(authHeader).length && new URL(registry).protocol !== 'https:') {
        throw new Error('npm registry credentials require an HTTPS URL');
    }

    const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'npmdl-'));
    try {
        const dir = path.join(workRoot, resolvedBundleName);
        const tarballsDir = path.join(dir, 'npm', 'tarballs');
        await fs.promises.mkdir(tarballsDir, { recursive: true });
        await fs.promises.writeFile(path.join(dir, 'npm', 'package-lock.json'), lockText);
        const budget = new ByteBudget();

        for (let i = 0; i < entries.length; i++) {
            const e = entries[i]!;
            const url = e.resolved as string;
            let resolvedUrl: URL;
            try { resolvedUrl = new URL(url); }
            catch { throw new Error(`invalid tarball URL for ${e.name}@${e.version}`); }
            if (!['http:', 'https:'].includes(resolvedUrl.protocol) || resolvedUrl.username || resolvedUrl.password) {
                throw new Error(`tarball URL for ${e.name}@${e.version} must be HTTP(S) without credentials`);
            }
            const urlName = (() => {
                try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); }
                catch { return ''; }
            })();
            const filename = safeFilenamePart(urlName || `${e.name}-${e.version}.tgz`, `package-${i}.tgz`, 240);
            const dest = path.join(tarballsDir, `${i}-${filename}`);

            bus.emitEvent({ type: 'stage', stage: `download-${i}` });

            const headers = (registry && sameOrigin(url, registry)) ? authHeader : undefined;
            const res = await requestWithRetry({
                method: 'GET',
                url,
                responseType: 'stream',
                headers,
                // Never follow an authenticated request to another origin or to plaintext HTTP.
                maxRedirects: headers ? 0 : 5,
            });
            const total = Number.parseInt(String(res.headers['content-length'] ?? '0'), 10);
            assertFileSize(total || undefined, `npm package ${e.name}`);
            bus.emitEvent({ type: 'item-start', index: i, digest: `${e.name}@${e.version}`, total: total || undefined });

            let received = 0;
            const limiter = new Transform({
                transform(chunk: Buffer | string, _encoding, callback) {
                    const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
                    try {
                        received += bytes;
                        assertFileSize(received, `npm package ${e.name}`);
                        budget.consume(bytes);
                        bus.emitEvent({ type: 'item-progress', index: i, received, total: total || undefined });
                        callback(null, chunk);
                    } catch (error) {
                        callback(error as Error);
                    }
                },
            });
            const verifier = ssri.integrityStream({ integrity: e.integrity!, size: total || undefined });
            await pipeline(res.data, limiter, verifier, fs.createWriteStream(dest));

            bus.emitEvent({ type: 'item-done', index: i });
        }

        bus.emitEvent({ type: 'tar-writing' });
        const filename = `${resolvedBundleName}.tar`;
        const tarPath = path.join(workRoot, filename);
        await tar.c({ file: tarPath, cwd: dir }, ['.']);

        return { tarPath, filename, workRoot };
    } catch (error) {
        try { await fs.promises.rm(workRoot, { recursive: true, force: true }); } catch {}
        throw error;
    }
}
