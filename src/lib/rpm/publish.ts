import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { Agent as HttpsAgent } from 'node:https';

export type RpmUploadMethod = 'put' | 'post';

export type UploadRpmOptions = {
    filePath: string;
    fileName?: string;
    repositoryUrl: string;
    method?: RpmUploadMethod;
    username?: string;
    password?: string;
    token?: string;
    ignoreTlsVerify?: boolean;
};

export function normalizeRpmRepositoryUrl(raw: string, hasCredentials = false): string {
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        throw new Error('RPM repository URL is invalid');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('RPM repository URL must use HTTP or HTTPS');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('RPM repository URL must not contain credentials, a query, or a fragment');
    }
    if (hasCredentials && url.protocol !== 'https:') {
        throw new Error('RPM upload credentials require an HTTPS repository URL');
    }
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.toString();
}

export async function uploadRpmFile({
    filePath,
    fileName,
    repositoryUrl,
    method = 'put',
    username,
    password,
    token,
    ignoreTlsVerify = false,
}: UploadRpmOptions) {
    const hasCredentials = Boolean(token || username || password);
    const normalizedBase = normalizeRpmRepositoryUrl(repositoryUrl, hasCredentials);
    const filename = path.basename(fileName || filePath) || 'package.rpm';
    const targetUrl = new URL(encodeURIComponent(filename), normalizedBase).toString();
    const headers: Record<string, string> = {
        'Content-Type': 'application/x-rpm',
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    } else if (username || password) {
        headers.Authorization = `Basic ${Buffer.from(`${username || ''}:${password || ''}`, 'utf8').toString('base64')}`;
    }

    try {
        await axios.request({
            method: method.toUpperCase(),
            url: targetUrl,
            headers,
            data: fs.createReadStream(filePath),
            timeout: 5 * 60_000,
            maxRedirects: 0,
            maxBodyLength: Infinity,
            maxContentLength: 1024 * 1024,
            httpsAgent: ignoreTlsVerify ? new HttpsAgent({ rejectUnauthorized: false }) : undefined,
            validateStatus: (status) => status >= 200 && status < 300,
        });
    } catch (error: unknown) {
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            throw new Error(status ? `RPM upload failed with HTTP ${status}` : `RPM upload failed: ${error.code || 'network error'}`);
        }
        throw error;
    }
}
