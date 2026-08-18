function positiveIntegerFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const RESOURCE_LIMITS = Object.freeze({
    maxDownloadItems: positiveIntegerFromEnv('MAX_DOWNLOAD_ITEMS', 5_000),
    maxSingleFileBytes: positiveIntegerFromEnv('MAX_SINGLE_FILE_BYTES', 5 * 1024 ** 3),
    maxBundleBytes: positiveIntegerFromEnv('MAX_BUNDLE_BYTES', 20 * 1024 ** 3),
    maxUploadFiles: positiveIntegerFromEnv('MAX_UPLOAD_FILES', 100),
    maxUploadBytes: positiveIntegerFromEnv('MAX_UPLOAD_BYTES', 20 * 1024 ** 3),
});

export function assertItemCount(count: number, kind = 'items'): void {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`invalid ${kind} count`);
    if (count > RESOURCE_LIMITS.maxDownloadItems) {
        throw new Error(`${kind} count exceeds limit (${RESOURCE_LIMITS.maxDownloadItems})`);
    }
}

export function assertFileSize(size: number | undefined, kind = 'file'): void {
    if (size === undefined || !Number.isFinite(size)) return;
    if (size < 0 || size > RESOURCE_LIMITS.maxSingleFileBytes) {
        throw new Error(`${kind} size exceeds limit (${RESOURCE_LIMITS.maxSingleFileBytes} bytes)`);
    }
}

/** Mutable byte budget shared by all downloads in one bundle. */
export class ByteBudget {
    private consumed = 0;

    constructor(private readonly limit = RESOURCE_LIMITS.maxBundleBytes) {}

    consume(bytes: number, kind = 'bundle'): void {
        if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`invalid ${kind} byte count`);
        this.consumed += bytes;
        if (this.consumed > this.limit) {
            throw new Error(`${kind} size exceeds limit (${this.limit} bytes)`);
        }
    }

    get used(): number {
        return this.consumed;
    }
}
