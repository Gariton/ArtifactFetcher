import { globalBusMap } from '@/lib/progressBus';

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

// 完了/失敗したジョブとその ProgressBus を一定時間後に破棄する。
// 長期稼働でメモリが無制限に増えないようにするためのTTL。
const TTL_MS = Number(process.env.JOB_TTL_MS || 30 * 60 * 1000);
const SWEEP_INTERVAL_MS = Number(process.env.JOB_SWEEP_INTERVAL_MS || 5 * 60 * 1000);

/**
 * Drop-in replacement for the previous `Map` so existing call sites
 * (`jobStore.set/get/delete`) keep working, but every record carries
 * timestamps and finished jobs are garbage-collected together with their bus.
 */
class JobStore {
    private map = new Map<string, JobRecord>();

    set(jobId: string, input: JobInput): this {
        const existing = this.map.get(jobId);
        const now = Date.now();
        this.map.set(jobId, {
            ...input,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        });
        return this;
    }

    get(jobId: string): JobRecord | undefined {
        return this.map.get(jobId);
    }

    has(jobId: string): boolean {
        return this.map.has(jobId);
    }

    delete(jobId: string): boolean {
        globalBusMap.delete(jobId);
        return this.map.delete(jobId);
    }

    /** Evict finished jobs (and their buses) whose last update is older than the TTL. */
    sweep(now = Date.now()): void {
        for (const [jobId, record] of this.map) {
            const finished = record.status === 'done' || record.status === 'error';
            if (finished && now - record.updatedAt > TTL_MS) {
                this.delete(jobId);
            }
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
    const timer = setInterval(() => jobStore.sweep(), SWEEP_INTERVAL_MS);
    // ジョブのスイープのためにイベントループを起こし続けない。
    timer.unref?.();
    globalRef.__JOB_SWEEP_TIMER__ = timer;
}
