export type JobStatus = 'queued' | 'running' | 'done' | 'error';
export type JobRecord = {
    status: JobStatus;
    filename?: string;
    objectKey?: string;
    tarPath?: string;
    error?: string;
}

export const jobStore: Map<string, JobRecord> = (global as any).__JOB_STORE__ || new Map();
if (!(global as any).__JOB_STORE__) (global as any).__JOB_STORE__ = jobStore;
