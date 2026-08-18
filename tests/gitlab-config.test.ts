import assert from 'node:assert/strict';
import test from 'node:test';
import {
    readGitLabPublicConfig,
    readGitLabRuntimeConfig,
} from '../src/lib/gitlab/config';

test('GitLab runtime configuration reads and trims dotenv values', () => {
    assert.deepEqual(readGitLabRuntimeConfig({
        GITLAB_BASE_URL: '  https://gitlab.internal.example/  ',
        GITLAB_TOKEN: '  glpat-secret  ',
    }), {
        baseUrl: 'https://gitlab.internal.example/',
        token: 'glpat-secret',
    });
});

test('GitLab public configuration never exposes the configured token', () => {
    const config = readGitLabPublicConfig({
        GITLAB_BASE_URL: 'https://gitlab.internal.example',
        GITLAB_TOKEN: 'glpat-secret',
    });

    assert.deepEqual(config, {
        baseUrl: 'https://gitlab.internal.example',
        tokenConfigured: true,
    });
    assert.equal('token' in config, false);
});

test('GitLab configuration reports missing values consistently', () => {
    assert.deepEqual(readGitLabRuntimeConfig({}), { baseUrl: '', token: undefined });
    assert.deepEqual(readGitLabPublicConfig({}), { baseUrl: '', tokenConfigured: false });
});
