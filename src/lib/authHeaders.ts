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
