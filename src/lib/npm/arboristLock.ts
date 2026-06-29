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
 * registry URL を npm の nerf-dart 形式（`//host/path/`）に正規化する。
 * npm-registry-fetch はこのキー（`//host/path/:_authToken` など）で認証情報を引く。
 */
export function nerfDart(registry: string): string {
    const withSlash = registry.endsWith('/') ? registry : `${registry}/`;
    const u = new URL(withSlash);
    return `//${u.host}${u.pathname}`;
}

/**
 * 指定レジストリのホストに対してのみ有効な認証設定（nerf-dart スコープ）を作る。
 * forceAuth と異なり、そのホスト以外（public npm 等）には認証情報を送らないため、
 * プライベートスコープ + public 依存の混在を安全に解決できる。
 *
 * - username + secret → Basic（username / _password[base64]）
 * - username なしで token/secret のみ → Bearer（_authToken）
 */
export function buildNpmRegistryAuth(registry: string, auth?: NpmAuth): Record<string, string> {
    if (!auth) return {};
    const nd = nerfDart(registry);
    const token = auth.token?.trim();
    const username = auth.username?.trim();
    const secret = auth.password ?? '';
    if (username) {
        return {
            [`${nd}:username`]: username,
            [`${nd}:_password`]: Buffer.from(secret).toString('base64'),
        };
    }
    if (token) return { [`${nd}:_authToken`]: token };
    if (secret) return { [`${nd}:_authToken`]: secret };
    return {};
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

    const arbOpts: Record<string, unknown> = { path: work };
    if (registry) {
        // 指定パッケージのうちスコープ付き（@scope/...）のスコープを抽出する。
        const scopes = Array.from(new Set(
            specs.map((s) => { try { return npa(s).scope; } catch { return undefined; } })
                .filter((s): s is string => !!s)
        ));
        if (scopes.length) {
            // スコープ単位でレジストリを割り当てる。
            // → @scope は指定レジストリから、その他（public 依存）は既定の npm から解決。
            for (const scope of scopes) arbOpts[`${scope}:registry`] = registry;
        } else {
            // スコープ無し → 既定レジストリ自体を差し替える（プライベートミラー想定）。
            arbOpts.registry = registry;
        }
        // 認証は指定レジストリのホストにのみ送る（public npm にトークンを漏らさない）。
        Object.assign(arbOpts, buildNpmRegistryAuth(registry, auth));
    }

    const arb = new Arborist(arbOpts as any);
    bus.emitEvent({ type: 'stage', stage: 'resolve-deps' });
    await arb.reify({ add: [], save: true });
    const lockText = await fs.promises.readFile(path.join(work, 'package-lock.json'), 'utf8');
    return { lockText, workDir: work };
}