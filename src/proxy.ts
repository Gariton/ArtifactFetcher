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
const ALLOWED_ORIGINS = process.env.APP_ALLOWED_ORIGINS || '';
const TRUST_PROXY_HEADERS = /^(1|true|on|yes)$/i.test(process.env.TRUST_PROXY_HEADERS || '');

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

function normalizeOrigin(value: string): string | null {
    try {
        const url = new URL(value.trim());
        return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
    } catch {
        return null;
    }
}

function hasTrustedMutationOrigin(req: NextRequest): boolean {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) return true;
    const origin = req.headers.get('origin');
    const fetchSite = req.headers.get('sec-fetch-site')?.toLowerCase();
    if (!origin) return fetchSite !== 'cross-site';
    if (origin === 'null') return false;

    const allowed = new Set<string>([req.nextUrl.origin]);
    for (const candidate of ALLOWED_ORIGINS.split(',')) {
        const normalized = normalizeOrigin(candidate);
        if (normalized) allowed.add(normalized);
    }
    if (TRUST_PROXY_HEADERS) {
        const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
        const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
        if (forwardedHost && /^(https?)$/i.test(forwardedProto || '')) {
            const normalized = normalizeOrigin(`${forwardedProto}://${forwardedHost}`);
            if (normalized) allowed.add(normalized);
        }
    }
    const normalized = normalizeOrigin(origin);
    return Boolean(normalized && allowed.has(normalized));
}

export function proxy(req: NextRequest) {
    const isAdmin = req.nextUrl.pathname.startsWith('/admin');

    if (!hasTrustedMutationOrigin(req)) {
        return new NextResponse('Untrusted request origin', { status: 403 });
    }

    if (Boolean(APP_USER) !== Boolean(APP_PASSWORD)) {
        return new NextResponse('Application authentication is misconfigured', { status: 503 });
    }
    if (isAdmin && Boolean(ADMIN_USER) !== Boolean(ADMIN_PASSWORD)) {
        return new NextResponse('Admin authentication is misconfigured', { status: 503 });
    }

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
    //
    // ただしアップロード系 API（multipart の大容量ボディ）は除外する。
    // ミドルウェアを通過するリクエストは Next.js がボディを tee して
    // experimental.middlewareClientMaxBodySize（既定 10MB）で打ち切るため、
    // 大きな tar/パッケージが途中で切られ busboy が "Unexpected end of form" を
    // 投げてしまう。これらのルートはミドルウェアを通さず元のボディを
    // 直接ストリーミングさせる（メモリにバッファせず安全に大容量を扱える）。
    // 除外対象の Route Handler は requireUploadAccess() で同じ Basic 認証、
    // Origin 検証、および機能フラグをボディ読み取り前に強制する。
    matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health|api/(?:docker|npm|pip|rpm)/upload).*)'],
};
