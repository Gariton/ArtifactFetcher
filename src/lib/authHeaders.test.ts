import assert from 'node:assert/strict';
import test from 'node:test';
import {
    REGISTRY_USERNAME_HEADER,
    resolveUploadAuth,
    sameRegistryTarget,
} from './authHeaders';

test('server credentials are used only for the configured registry', () => {
    const defaults = { username: 'server-user', password: 'server-password' };
    const matching = resolveUploadAuth(new Headers(), {
        requestedRegistry: 'https://registry.example/repository/npm/',
        configuredRegistry: 'https://registry.example/repository/npm',
        defaults,
    });
    assert.deepEqual(matching, defaults);

    const unrelated = resolveUploadAuth(new Headers(), {
        requestedRegistry: 'https://attacker.example/upload',
        configuredRegistry: 'https://registry.example/repository/npm',
        defaults,
    });
    assert.deepEqual(unrelated, {});
});

test('explicit request credentials never get mixed with server defaults', () => {
    const headers = new Headers({ [REGISTRY_USERNAME_HEADER]: encodeURIComponent('request-user') });
    const result = resolveUploadAuth(headers, {
        requestedRegistry: 'registry.example',
        configuredRegistry: 'registry.example',
        defaults: { username: 'server-user', password: 'server-password' },
    });
    assert.deepEqual(result, { username: 'request-user', password: undefined, token: undefined });
});

test('registry comparison normalizes scheme-less hosts and trailing slashes but not paths', () => {
    assert.equal(sameRegistryTarget('registry.example/', 'https://registry.example'), true);
    assert.equal(sameRegistryTarget('https://registry.example/a', 'https://registry.example/b'), false);
    assert.equal(sameRegistryTarget('https://user@registry.example', 'https://registry.example'), false);
});
