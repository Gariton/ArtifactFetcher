import { NextRequest, NextResponse } from 'next/server';

// アプリへの簡易的なアクセス制御（Basic 認証）。
//
// 2種類の認証を独立して設定できる:
//  - 全体:   APP_AUTH_USER / APP_AUTH_PASSWORD     … 全ルートを保護
//  - 管理画面: ADMIN_AUTH_USER / ADMIN_AUTH_PASSWORD … /admin 以下のみ保護
//
// /admin に管理画面用の認証が設定されている場合はそちらを優先する
// （ブラウザは1リクエストにつき1つの Basic 認証情報しか送れないため、
//  パスごとに要求する認証を1つに絞る）。いずれも未設定なら従来どおり素通し。
//
// このアプリはサーバーから任意の外部レジストリ/URLへ接続するため、
// 公開ネットワークに置く場合は認証の有効化を強く推奨する。

const APP_USER = process.env.APP_AUTH_USER;
const APP_PASSWORD = process.env.APP_AUTH_PASSWORD;
const ADMIN_USER = process.env.ADMIN_AUTH_USER;
const ADMIN_PASSWORD = process.env.ADMIN_AUTH_PASSWORD;

function unauthorized(realm: string): NextResponse {
    return new NextResponse('Authentication required', {
        status: 401,
        headers: { 'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"` },
    });
}

// 長さに依存しない比較でタイミング攻撃を緩和する。
function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

// Basic 認証を検証する。成功なら null、失敗なら 401 レスポンスを返す。
function requireBasic(req: NextRequest, expectedUser: string, expectedPassword: string, realm: string): NextResponse | null {
    const header = req.headers.get('authorization') || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme !== 'Basic' || !encoded) return unauthorized(realm);

    let decoded: string;
    try {
        decoded = atob(encoded);
    } catch {
        return unauthorized(realm);
    }
    const sep = decoded.indexOf(':');
    if (sep < 0) return unauthorized(realm);
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);

    if (safeEqual(user, expectedUser) && safeEqual(pass, expectedPassword)) {
        return null;
    }
    return unauthorized(realm);
}

export function middleware(req: NextRequest) {
    const isAdmin = req.nextUrl.pathname.startsWith('/admin');

    // /admin は管理画面専用の認証を優先する。
    if (isAdmin && ADMIN_USER && ADMIN_PASSWORD) {
        return requireBasic(req, ADMIN_USER, ADMIN_PASSWORD, 'ArtifactFetcher Admin') ?? NextResponse.next();
    }

    // それ以外（および管理画面用の認証が未設定の /admin）は全体認証を適用する。
    if (APP_USER && APP_PASSWORD) {
        return requireBasic(req, APP_USER, APP_PASSWORD, 'ArtifactFetcher') ?? NextResponse.next();
    }

    return NextResponse.next();
}

export const config = {
    // 静的アセットと Next.js 内部リクエストを除く全ルートを保護する。
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
