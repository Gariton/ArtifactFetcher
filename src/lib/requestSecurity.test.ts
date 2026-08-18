import assert from 'node:assert/strict';
import test from 'node:test';
import { requireUploadAccess } from './requestSecurity';

function request(headers: Record<string, string> = {}) {
    return { url: 'https://artifact.example/api/docker/upload', headers: new Headers(headers) };
}

test('upload feature flags fail closed', () => {
    assert.equal(requireUploadAccess(request(), 'docker', {})?.status, 403);
    assert.equal(requireUploadAccess(request(), 'docker', { DOCKER_UPLOAD: 'false' })?.status, 403);
    assert.equal(requireUploadAccess(request(), 'docker', { DOCKER_UPLOAD: 'yes' }), null);
});

test('route-level Basic authentication protects middleware-excluded uploads', () => {
    const env = { DOCKER_UPLOAD: 'yes', APP_AUTH_USER: 'alice', APP_AUTH_PASSWORD: 'secret' };
    assert.equal(requireUploadAccess(request(), 'docker', env)?.status, 401);

    const authorization = `Basic ${Buffer.from('alice:secret').toString('base64')}`;
    assert.equal(requireUploadAccess(request({ authorization }), 'docker', env), null);
});

test('a partially configured Basic authentication boundary fails closed', () => {
    const result = requireUploadAccess(request(), 'docker', {
        DOCKER_UPLOAD: 'yes',
        APP_AUTH_USER: 'alice',
    });
    assert.equal(result?.status, 503);
});

test('browser uploads require a trusted origin', () => {
    const env = { DOCKER_UPLOAD: 'yes' };
    assert.equal(requireUploadAccess(request({ origin: 'https://evil.example' }), 'docker', env)?.status, 403);
    assert.equal(requireUploadAccess(request({ origin: 'https://artifact.example' }), 'docker', env), null);
    assert.equal(requireUploadAccess(request({ 'sec-fetch-site': 'cross-site' }), 'docker', env)?.status, 403);
});

test('explicit additional origins and opted-in proxy headers are supported', () => {
    assert.equal(requireUploadAccess(request({ origin: 'https://portal.example' }), 'docker', {
        DOCKER_UPLOAD: 'yes',
        APP_ALLOWED_ORIGINS: 'https://portal.example',
    }), null);

    const proxied = request({
        origin: 'https://public.example',
        'x-forwarded-host': 'public.example',
        'x-forwarded-proto': 'https',
    });
    assert.equal(requireUploadAccess(proxied, 'docker', { DOCKER_UPLOAD: 'yes' })?.status, 403);
    assert.equal(requireUploadAccess(proxied, 'docker', { DOCKER_UPLOAD: 'yes', TRUST_PROXY_HEADERS: 'yes' }), null);
});
