import { NextRequest, NextResponse } from 'next/server';

// アプリ全体に簡易的なアクセス制御を掛ける。
// APP_AUTH_USER / APP_AUTH_PASSWORD が設定されている場合のみ Basic 認証を要求する。
// 未設定の場合は従来どおり誰でもアクセスできる（後方互換）。
//
// このアプリはサーバーから任意の外部レジストリ/URLへ接続するため、
// 公開ネットワークに置く場合は必ずこの認証を有効化することを推奨する。

const AUTH_USER = process.env.APP_AUTH_USER;
const AUTH_PASSWORD = process.env.APP_AUTH_PASSWORD;

function unauthorized(): NextResponse {
    return new NextResponse('Authentication required', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="ArtifactFetcher", charset="UTF-8"' },
    });
}

// 長さに依存しない比較でタイミング攻撃を緩和する。
function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export function middleware(req: NextRequest) {
    // 認証情報が未設定なら何もしない。
    if (!AUTH_USER || !AUTH_PASSWORD) return NextResponse.next();

    const header = req.headers.get('authorization') || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme !== 'Basic' || !encoded) return unauthorized();

    let decoded: string;
    try {
        decoded = atob(encoded);
    } catch {
        return unauthorized();
    }
    const sep = decoded.indexOf(':');
    if (sep < 0) return unauthorized();
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);

    if (safeEqual(user, AUTH_USER) && safeEqual(pass, AUTH_PASSWORD)) {
        return NextResponse.next();
    }
    return unauthorized();
}

export const config = {
    // 静的アセットと Next.js 内部リクエストを除く全ルートを保護する。
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
