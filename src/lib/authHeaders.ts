// Registry credentials (username / password / bearer token) are transmitted via
// HTTP headers instead of URL query strings so they are never captured by
// access logs, reverse proxies, or browser history. Values are percent-encoded
// to stay within the ASCII range required for valid header values (so non-ASCII
// passwords do not break `fetch`).

export type AuthHeaderInput = {
    username?: string;
    password?: string;
    token?: string;
};

export const REGISTRY_USERNAME_HEADER = 'x-registry-username';
export const REGISTRY_PASSWORD_HEADER = 'x-registry-password';
export const REGISTRY_TOKEN_HEADER = 'x-registry-token';

/** Client side: build the credential headers to attach to an upload request. */
export function buildAuthHeaders(input: AuthHeaderInput): Record<string, string> {
    const headers: Record<string, string> = {};
    const username = input.username?.trim();
    const token = input.token?.trim();
    if (username) headers[REGISTRY_USERNAME_HEADER] = encodeURIComponent(username);
    if (input.password) headers[REGISTRY_PASSWORD_HEADER] = encodeURIComponent(input.password);
    if (token) headers[REGISTRY_TOKEN_HEADER] = encodeURIComponent(token);
    return headers;
}

function decodeHeader(value: string | null): string | undefined {
    if (!value) return undefined;
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/** Server side: read the credential headers from an incoming request. */
export function readUploadAuth(headers: Headers): AuthHeaderInput {
    return {
        username: decodeHeader(headers.get(REGISTRY_USERNAME_HEADER)),
        password: decodeHeader(headers.get(REGISTRY_PASSWORD_HEADER)),
        token: decodeHeader(headers.get(REGISTRY_TOKEN_HEADER)),
    };
}

function hasUploadAuthHeaders(headers: Headers): boolean {
    return [REGISTRY_USERNAME_HEADER, REGISTRY_PASSWORD_HEADER, REGISTRY_TOKEN_HEADER]
        .some((name) => headers.has(name));
}

/**
 * Server side: use credentials explicitly supplied by the user, or server-side
 * defaults only when the requested registry is the configured registry.
 *
 * Checking the target is important: upload URLs are user controlled, so blindly
 * attaching environment credentials would disclose them to an attacker-controlled
 * endpoint. An explicit (even partial) credential set never gets mixed with the
 * server defaults.
 */
export function resolveUploadAuth(
    headers: Headers,
    options: {
        requestedRegistry: string;
        configuredRegistry?: string;
        defaults?: AuthHeaderInput;
    },
): AuthHeaderInput {
    if (hasUploadAuthHeaders(headers)) return readUploadAuth(headers);
    if (!sameRegistryTarget(options.requestedRegistry, options.configuredRegistry)) return {};
    return compactAuth(options.defaults);
}

function compactAuth(input?: AuthHeaderInput): AuthHeaderInput {
    if (!input) return {};
    const result: AuthHeaderInput = {};
    if (input.username) result.username = input.username;
    if (input.password) result.password = input.password;
    if (input.token) result.token = input.token;
    return result;
}

/** Compare registry endpoints while tolerating a trailing slash. */
export function sameRegistryTarget(requested: string, configured?: string): boolean {
    const left = normalizeRegistryTarget(requested);
    const right = normalizeRegistryTarget(configured || '');
    return Boolean(left && right && left === right);
}

function normalizeRegistryTarget(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
        const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
        const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        url.hash = '';
        url.search = '';
        url.pathname = url.pathname.replace(/\/+$/, '') || '/';
        return url.toString().replace(/\/$/, '');
    } catch {
        return null;
    }
}
