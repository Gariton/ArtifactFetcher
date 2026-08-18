import { timingSafeEqual } from 'node:crypto';

export type UploadFeature = 'docker' | 'npm' | 'pip' | 'rpm';

type RequestLike = {
    headers: Headers;
    url: string;
};

type Environment = Record<string, string | undefined>;

const FEATURE_ENV: Record<UploadFeature, string> = {
    docker: 'DOCKER_UPLOAD',
    npm: 'NPM_UPLOAD',
    pip: 'PIP_UPLOAD',
    rpm: 'RPM_UPLOAD',
};

export function isEnabled(value: string | undefined): boolean {
    return /^(1|true|on|yes)$/i.test(value?.trim() || '');
}

/**
 * Route-level protection for upload endpoints excluded from middleware so their
 * request bodies can remain streaming. Returns a response on rejection.
 */
export function requireUploadAccess(
    request: RequestLike,
    feature: UploadFeature,
    env: Environment = process.env,
): Response | null {
    const authFailure = requireAppBasicAuth(request.headers, env);
    if (authFailure) return authFailure;

    const originFailure = requireTrustedOrigin(request, env);
    if (originFailure) return originFailure;

    if (!isEnabled(env[FEATURE_ENV[feature]])) {
        return jsonError(`${feature} upload is disabled`, 403);
    }
    return null;
}

function requireAppBasicAuth(headers: Headers, env: Environment): Response | null {
    const expectedUser = env.APP_AUTH_USER || '';
    const expectedPassword = env.APP_AUTH_PASSWORD || '';

    // A half-configured authentication boundary must fail closed.
    if (Boolean(expectedUser) !== Boolean(expectedPassword)) {
        return jsonError('application authentication is misconfigured', 503);
    }
    if (!expectedUser && !expectedPassword) return null;

    const credentials = parseBasicAuth(headers.get('authorization'));
    if (
        !credentials
        || !safeEqual(credentials.username, expectedUser)
        || !safeEqual(credentials.password, expectedPassword)
    ) {
        return new Response(JSON.stringify({ error: 'authentication required' }), {
            status: 401,
            headers: {
                'Content-Type': 'application/json',
                'WWW-Authenticate': 'Basic realm="ArtifactFetcher", charset="UTF-8"',
            },
        });
    }
    return null;
}

function parseBasicAuth(value: string | null): { username: string; password: string } | null {
    if (!value) return null;
    const match = /^Basic\s+([^\s]+)$/i.exec(value);
    if (!match) return null;
    try {
        const decoded = Buffer.from(match[1], 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator < 0) return null;
        return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
    } catch {
        return null;
    }
}

function safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

function requireTrustedOrigin(request: RequestLike, env: Environment): Response | null {
    const origin = request.headers.get('origin');
    const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();

    // Non-browser clients normally omit both headers. Browser cross-site requests
    // carry Origin (and modern browsers also Sec-Fetch-Site).
    if (!origin) {
        return fetchSite === 'cross-site' ? jsonError('cross-site upload is not allowed', 403) : null;
    }
    if (origin === 'null') return jsonError('untrusted request origin', 403);

    const allowed = allowedOrigins(request, env);
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin || !allowed.has(normalizedOrigin)) {
        return jsonError('untrusted request origin', 403);
    }
    return null;
}

function allowedOrigins(request: RequestLike, env: Environment): Set<string> {
    const result = new Set<string>();
    const requestOrigin = normalizeOrigin(request.url);
    if (requestOrigin) result.add(requestOrigin);

    for (const candidate of (env.APP_ALLOWED_ORIGINS || '').split(',')) {
        const normalized = normalizeOrigin(candidate);
        if (normalized) result.add(normalized);
    }

    if (isEnabled(env.TRUST_PROXY_HEADERS)) {
        const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
        const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
        if (forwardedHost && /^(https?)$/i.test(forwardedProto || '')) {
            const forwardedOrigin = normalizeOrigin(`${forwardedProto}://${forwardedHost}`);
            if (forwardedOrigin) result.add(forwardedOrigin);
        }
    }
    return result;
}

function normalizeOrigin(value: string): string | null {
    try {
        const url = new URL(value.trim());
        return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
    } catch {
        return null;
    }
}

function jsonError(error: string, status: number): Response {
    return new Response(JSON.stringify({ error }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
