import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';

export type RequestLogEntry = {
    id: string;
    method: string;
    path: string;
    ip: string;
    timestamp: string;
    info?: string;
};

const globalKey = '__REQUEST_LOG__';
const store: RequestLogEntry[] = (global as any)[globalKey] || [];
if (!(global as any)[globalKey]) (global as any)[globalKey] = store;

function extractIp(req: NextRequest): string {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) {
        const first = forwarded.split(',')[0]?.trim();
        if (first) return first;
    }
    const realIp = req.headers.get('x-real-ip');
    if (realIp) return realIp;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const reqIp = (req as any).ip as string | undefined;
    if (reqIp) return reqIp;
    return 'unknown';
}

export function logRequest(req: NextRequest, info?: string) {
    const entry: RequestLogEntry = {
        id: nanoid(),
        method: req.method,
        path: req.nextUrl?.pathname || new URL(req.url).pathname,
        ip: extractIp(req),
        timestamp: new Date().toISOString(),
        info,
    };
    store.push(entry);
    const maxEntries = 500;
    if (store.length > maxEntries) {
        store.splice(0, store.length - maxEntries);
    }
}

export function getRequestLogs(): RequestLogEntry[] {
    return [...store].reverse();
}
