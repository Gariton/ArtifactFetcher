import axios from 'axios';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { parseLockfile } from './lockParser';
import { ProgressBus, type LockEntry } from '../progressBus';
import type { NpmAuth } from './arboristLock';

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

function sameHost(a: string, b: string): boolean {
    try { return new URL(a).host === new URL(b).host; }
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
    bus.emitEvent({ type: 'stage', stage: 'parse-lockfile' });
    let entries: LockEntry[] = parseLockfile(lockText);
    entries = entries.filter(e => !!e.resolved);
    bus.emitEvent({ type: 'manifest-resolved', items: entries });

    // レジストリと同一ホストの tarball にのみ認証ヘッダを付与する。
    // （public な tarball 配信元へ資格情報を漏らさないため）
    const authHeader = buildNpmAuthHeader(auth);

    const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'npmdl-'));
    const dir = path.join(workRoot, bundleName);
    await fs.promises.mkdir(path.join(dir, 'npm', 'tarballs'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'npm', 'package-lock.json'), lockText);
    
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        const url = e.resolved as string;
        const filename = (url.split('/').pop()?.split('?')[0]) || `${e.name}-${e.version}.tgz`;
        const dest = path.join(dir, 'npm', 'tarballs', filename);
        
        bus.emitEvent({ type: 'stage', stage: `download-${i}` });
        
        const headers = (registry && sameHost(url, registry)) ? authHeader : undefined;
        const res = await requestWithRetry({ method: 'GET', url, responseType: 'stream', headers });
        const total = parseInt(res.headers['content-length'] || '0', 10);
        bus.emitEvent({ type: 'item-start', index: i, digest: `${e.name}@${e.version}`, total: total || undefined });
        
        let received = 0;
        await new Promise<void>((resolve, reject) => {
            res.data.on('data', (chunk: Buffer | string) => {
                if (typeof chunk === 'string') chunk = Buffer.from(chunk);
                received += (chunk as Buffer).length;
                bus.emitEvent({ type: 'item-progress', index: i, received, total: total || undefined });
            });
            const file = fs.createWriteStream(dest);
            res.data.on('error', reject);
            file.on('error', reject);
            file.on('finish', resolve);
            res.data.pipe(file);
        });
        
        bus.emitEvent({ type: 'item-done', index: i });
    }
    
    bus.emitEvent({ type: 'tar-writing' });
    const tarPath = path.join(workRoot, `${bundleName}.tar`);
    await tar.c({ file: tarPath, cwd: dir, sync: true }, ['.']);
    bus.emitEvent({ type: 'done', filename: `${bundleName}.tar` });
    
    return { tarPath, filename: `${bundleName}.tar`, workRoot };
}
