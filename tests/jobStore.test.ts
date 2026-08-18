import assert from 'node:assert/strict';
import test from 'node:test';
import { JobStore, type JobRecord } from '../src/lib/jobStore';

const JOB_ONE = 'Abcd_efgh-12345678901';
const JOB_TWO = 'Abcd_efgh-12345678902';

test('client reservations are validated and bounded', () => {
    const store = new JobStore({ maxJobs: 1, cleanupArtifact: async () => undefined });
    assert.equal(store.reserve('not-a-nanoid'), undefined);
    assert.equal(store.reserve(JOB_ONE)?.status, 'queued');
    assert.equal(store.reserve(JOB_ONE)?.status, 'queued');
    assert.equal(store.reserve(JOB_TWO), undefined);
    assert.equal(store.size, 1);
});

test('upload claims are atomic and reject reuse', () => {
    const store = new JobStore({ maxJobs: 1, cleanupArtifact: async () => undefined });
    assert.equal(store.reserve(JOB_ONE)?.status, 'queued');
    assert.equal(store.claim(JOB_ONE), true);
    assert.equal(store.get(JOB_ONE)?.status, 'running');
    assert.equal(store.claim(JOB_ONE), false);
    assert.equal(store.create(JOB_TWO), false);
});

test('sweep expires queued, running and completed jobs and cleans artifacts', async () => {
    const cleaned: JobRecord[] = [];
    const store = new JobStore({
        terminalTtlMs: 1,
        queuedTtlMs: 1,
        runningTtlMs: 1,
        cleanupArtifact: async (record) => { cleaned.push(record); },
    });
    store.set(JOB_ONE, { status: 'done', filename: 'bundle.tar', objectKey: `${JOB_ONE}/bundle.tar` });
    store.set(JOB_TWO, { status: 'running' });
    const queuedId = 'Abcd_efgh-12345678903';
    store.reserve(queuedId);

    await store.sweep(Date.now() + 10);

    assert.equal(store.size, 0);
    assert.equal(cleaned.length, 3);
    assert.equal(cleaned.some((record) => record.objectKey === `${JOB_ONE}/bundle.tar`), true);
});

test('sweep retains a job when artifact cleanup fails so it can retry', async () => {
    const store = new JobStore({
        terminalTtlMs: 1,
        cleanupArtifact: async () => { throw new Error('temporary S3 failure'); },
    });
    store.set(JOB_ONE, { status: 'done', filename: 'bundle.tar', objectKey: `${JOB_ONE}/bundle.tar` });

    await store.sweep(Date.now() + 10);

    assert.equal(store.has(JOB_ONE), true);
});
