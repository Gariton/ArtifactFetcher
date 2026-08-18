import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';

test('proxy rejects cross-origin state-changing requests', () => {
    const rejected = proxy(new NextRequest('https://artifact.example/api/npm/start', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
    }));
    assert.equal(rejected.status, 403);

    const accepted = proxy(new NextRequest('https://artifact.example/api/npm/start', {
        method: 'POST',
        headers: { origin: 'https://artifact.example' },
    }));
    assert.notEqual(accepted.status, 403);
});

test('proxy permits read-only requests regardless of navigation origin', () => {
    const response = proxy(new NextRequest('https://artifact.example/', {
        method: 'GET',
        headers: { origin: 'https://portal.example' },
    }));
    assert.notEqual(response.status, 403);
});
