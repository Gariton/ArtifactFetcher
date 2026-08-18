import fs from 'node:fs/promises';
import { globalBusMap } from '@/lib/progressBus';
import { cleanupExpiredS3Artifacts, deleteS3Object, isS3Configured } from '@/lib/storage/s3';
import { isValidJobId } from '@/lib/inputSafety';

export type JobStatus = 'queued' | 'running' | 'done' | 'error';
export type JobRecord = {
    status: JobStatus;
    filename?: string;
    objectKey?: string;
    tarPath?: string;
    error?: string;
    createdAt: number;
    updatedAt: number;
};

/** New job data accepted by `set` (timestamps are managed internally). */
export type JobInput = Omit<JobRecord, 'createdAt' | 'updatedAt'>;

type JobStoreOptions = {
    terminalTtlMs?: number;
    queuedTtlMs?: number;
    runningTtlMs?: number;
    maxJobs?: number;
    cleanupArtifact?: (record: JobRecord) => Promise<void>;
};

function positiveInteger(raw: string | undefined, fallback: number) {
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_TERMINAL_TTL_MS = positiveInteger(process.env.JOB_TTL_MS, 30 * 60 * 1000);
const DEFAULT_QUEUED_TTL_MS = positiveInteger(process.env.JOB_QUEUED_TTL_MS, 10 * 60 * 1000);
const DEFAULT_RUNNING_TTL_MS = positiveInteger(process.env.JOB_RUNNING_TTL_MS, 6 * 60 * 60 * 1000);
const DEFAULT_MAX_JOBS = positiveInteger(process.env.JOB_MAX_RECORDS, 1_000);
const SWEEP_INTERVAL_MS = positiveInteger(process.env.JOB_SWEEP_INTERVAL_MS, 5 * 60 * 1000);

async function cleanupStoredArtifact(record: JobRecord): Promise<void> {
    if (record.objectKey) {
        await deleteS3Object(record.objectKey);
    } else if (record.tarPath) {
        await fs.rm(record.tarPath, { force: true });
    }
}

/** In-memory job index with bounded reservations and artifact-aware TTL eviction. */
export class JobStore {
    private map = new Map<string, JobRecord>();
    private readonly terminalTtlMs: number;
    private readonly queuedTtlMs: number;
    private readonly runningTtlMs: number;
    private readonly maxJobs: number;
    private readonly cleanupArtifact: (record: JobRecord) => Promise<void>;
    private sweepInProgress = false;

    constructor(options: JobStoreOptions = {}) {
        this.terminalTtlMs = options.terminalTtlMs ?? DEFAULT_TERMINAL_TTL_MS;
        this.queuedTtlMs = options.queuedTtlMs ?? DEFAULT_QUEUED_TTL_MS;
        this.runningTtlMs = options.runningTtlMs ?? DEFAULT_RUNNING_TTL_MS;
        this.maxJobs = options.maxJobs ?? DEFAULT_MAX_JOBS;
        this.cleanupArtifact = options.cleanupArtifact ?? cleanupStoredArtifact;
    }

    set(jobId: string, input: JobInput): this {
        const existing = this.map.get(jobId);
        if (!existing && this.map.size >= this.maxJobs) {
            throw new Error(`job capacity exceeded (${this.maxJobs})`);
        }
        const now = Date.now();
        this.map.set(jobId, {
            ...existing,
            ...input,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        });
        return this;
    }

    /** Create a new bounded job without throwing on capacity/collision. */
    create(jobId: string, input: JobInput = { status: 'queued' }): boolean {
        if (!isValidJobId(jobId) || this.map.has(jobId) || this.map.size >= this.maxJobs) return false;
        this.set(jobId, input);
        return true;
    }

    /** Atomically claim a queued client-reserved upload id before reading its body. */
    claim(jobId: string): boolean {
        if (!isValidJobId(jobId)) return false;
        const existing = this.map.get(jobId);
        if (existing && existing.status !== 'queued') return false;
        if (!existing && this.map.size >= this.maxJobs) return false;
        this.set(jobId, { status: 'running' });
        return true;
    }

    /** Reserve a client-generated upload id before its POST request arrives. */
    reserve(jobId: string): JobRecord | undefined {
        if (!isValidJobId(jobId)) return undefined;
        const existing = this.map.get(jobId);
        if (existing) return existing;
        if (!this.create(jobId)) return undefined;
        return this.map.get(jobId);
    }

    get(jobId: string): JobRecord | undefined {
        return this.map.get(jobId);
    }

    has(jobId: string): boolean {
        return this.map.has(jobId);
    }

    get size(): number {
        return this.map.size;
    }

    delete(jobId: string): boolean {
        globalBusMap.get(jobId)?.emit('close');
        globalBusMap.delete(jobId);
        return this.map.delete(jobId);
    }

    async deleteWithArtifact(jobId: string): Promise<boolean> {
        const record = this.map.get(jobId);
        if (!record) return false;
        await this.cleanupArtifact(record);
        return this.delete(jobId);
    }

    private isExpired(record: JobRecord, now: number): boolean {
        const age = now - record.updatedAt;
        if (record.status === 'queued') return age > this.queuedTtlMs;
        if (record.status === 'running') return age > this.runningTtlMs;
        return age > this.terminalTtlMs;
    }

    /**
     * Evict all expired states. S3/local cleanup is attempted before removing the
     * record, so transient storage failures remain visible and are retried later.
     */
    async sweep(now = Date.now()): Promise<void> {
        if (this.sweepInProgress) return;
        this.sweepInProgress = true;
        try {
            for (const [jobId, record] of this.map) {
                if (!this.isExpired(record, now)) continue;
                try {
                    await this.cleanupArtifact(record);
                    this.delete(jobId);
                } catch (error) {
                    console.error(`Failed to clean expired job ${jobId}`, error);
                }
            }
        } finally {
            this.sweepInProgress = false;
        }
    }
}

type GlobalWithStore = typeof globalThis & {
    __JOB_STORE__?: JobStore;
    __JOB_SWEEP_TIMER__?: ReturnType<typeof setInterval>;
};
const globalRef = global as GlobalWithStore;

export const jobStore: JobStore = globalRef.__JOB_STORE__ ?? new JobStore();
globalRef.__JOB_STORE__ = jobStore;

if (!globalRef.__JOB_SWEEP_TIMER__) {
    const timer = setInterval(() => {
        void jobStore.sweep().then(async () => {
            if (isS3Configured()) await cleanupExpiredS3Artifacts(DEFAULT_TERMINAL_TTL_MS);
        }).catch((error) => console.error('Failed to sweep expired jobs/artifacts', error));
    }, SWEEP_INTERVAL_MS);
    timer.unref?.();
    globalRef.__JOB_SWEEP_TIMER__ = timer;
}
