import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Arborist from '@npmcli/arborist';
import npa from 'npm-package-arg';
import { ProgressBus } from '../progressBus';

// プライベートレジストリ用の認証情報。upload 側と同じく
// 「ユーザー名 + パスワード/トークン」で受け取る。
export type NpmAuth = {
    username?: string;
    password?: string;
    token?: string;
};

/**
 * npm-registry-fetch の `forceAuth` 形式を組み立てる。
 * forceAuth はレジストリのホストに依らず全リクエスト（packument / tarball）に
 * 適用されるため、メタデータ解決とダウンロードの双方で認証が効く。
 *
 * - token あり → Bearer（_authToken）
 * - username + secret → Basic（_auth = base64(user:pass)）
 * - username なしで secret のみ → トークンとみなして Bearer
 */
export function buildNpmForceAuth(auth?: NpmAuth): Record<string, unknown> | undefined {
    if (!auth) return undefined;
    const token = auth.token?.trim();
    const username = auth.username?.trim();
    const secret = auth.password ?? '';
    if (token) return { _authToken: token, alwaysAuth: true };
    if (username) {
        const basic = Buffer.from(`${username}:${secret}`).toString('base64');
        return { _auth: basic, alwaysAuth: true };
    }
    if (secret) return { _authToken: secret, alwaysAuth: true };
    return undefined;
}

export async function makeLockFromSpecs(specs: string[], bus: ProgressBus, registry?: string, auth?: NpmAuth) {
    bus.emitEvent({ type: 'stage', stage: 'arborist-init' });
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'npmlock-'));
    const pkgJson = {
        name: 'tmp-project',
        version: '1.0.0',
        private: true,
        dependencies: Object.fromEntries(
            specs.map(s => { const p = npa(s); return [p.name!, p.rawSpec || 'latest']; })
        ),
    };
    await fs.promises.writeFile(path.join(work, 'package.json'), JSON.stringify(pkgJson, null, 2));

    const arbOpts: Record<string, unknown> = { path: work, registry: registry || undefined };
    const forceAuth = buildNpmForceAuth(auth);
    if (forceAuth) arbOpts.forceAuth = forceAuth;
    const arb = new Arborist(arbOpts as any);
    bus.emitEvent({ type: 'stage', stage: 'resolve-deps' });
    await arb.reify({ add: [], save: true });
    const lockText = await fs.promises.readFile(path.join(work, 'package-lock.json'), 'utf8');
    return { lockText, workDir: work };
}