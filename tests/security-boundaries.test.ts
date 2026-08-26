import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDockerUploadLocation } from '../src/lib/docker/registryPusher';
import {
    readDockerPublicRuntimeConfig,
    readNpmPublicRuntimeConfig,
    readPipPublicRuntimeConfig,
    readRpmPublicRuntimeConfig,
} from '../src/lib/publicRuntimeConfig';
import { redactSecrets, repositoriesForArtifact, type RpmRepository } from '../src/lib/rpm/downloader';

test('public runtime configuration never returns upload credentials', () => {
    const env = {
        DOCKER_UPLOAD_USERNAME: 'docker-user',
        DOCKER_UPLOAD_PASSWORD: 'docker-secret',
        NPM_UPLOAD_AUTH_TOKEN: 'npm-secret',
        PIP_UPLOAD_TOKEN: 'pip-secret',
        RPM_UPLOAD_PASSWORD: 'rpm-secret',
    };
    const result = {
        ...readDockerPublicRuntimeConfig(env),
        ...readNpmPublicRuntimeConfig(env),
        ...readPipPublicRuntimeConfig(env),
        ...readRpmPublicRuntimeConfig(env),
    };
    const keys = Object.keys(result);
    for (const key of keys) {
        assert.doesNotMatch(key, /(?:PASSWORD|USERNAME|AUTH_TOKEN|UPLOAD_TOKEN)$/);
    }
    const serialized = JSON.stringify(result);
    for (const secret of Object.values(env)) {
        assert.equal(serialized.includes(secret), false);
    }
});

test('public runtime configuration reads values supplied at request time', () => {
    const env = {
        DOCKER_UPLOAD: 'true',
        DOCKER_UPLOAD_REGISTRY: 'https://docker.example.test',
        NPM_UPLOAD: 'yes',
        NPM_UPLOAD_REGISTRY: 'https://npm.example.test',
        PIP_UPLOAD: '1',
        PIP_UPLOAD_REGISTRY: 'https://pip.example.test',
        PIP_UPLOAD_SKIP_EXISTING: 'true',
        RPM_UPLOAD: 'on',
        RPM_UPLOAD_REPOSITORY_URL: 'https://rpm.example.test',
        RPM_UPLOAD_METHOD: 'post',
        RPM_UPLOAD_IGNORE_TLS_VERIFY: 'true',
    };

    assert.deepEqual(readDockerPublicRuntimeConfig(env), {
        DOCKER_UPLOAD: 'true',
        DOCKER_UPLOAD_REGISTRY: 'https://docker.example.test',
    });
    assert.deepEqual(readNpmPublicRuntimeConfig(env), {
        NPM_UPLOAD: 'yes',
        NPM_UPLOAD_REGISTRY: 'https://npm.example.test',
    });
    assert.deepEqual(readPipPublicRuntimeConfig(env), {
        PIP_UPLOAD: '1',
        PIP_UPLOAD_REGISTRY: 'https://pip.example.test',
        PIP_UPLOAD_SKIP_EXISTING: 'true',
    });
    assert.deepEqual(readRpmPublicRuntimeConfig(env), {
        RPM_UPLOAD: 'on',
        RPM_UPLOAD_REPOSITORY_URL: 'https://rpm.example.test',
        RPM_UPLOAD_METHOD: 'post',
        RPM_UPLOAD_IGNORE_TLS_VERIFY: 'true',
    });
});

const repository: RpmRepository = {
    id: 'private',
    label: 'Private',
    folderName: 'private',
    baseUrl: 'https://rpm.example/repository/',
    gpgKeyUrl: 'https://rpm.example/keys/signing-key',
    username: 'artifact-user',
    password: 'highly-secret',
};

test('RPM artifact metadata contains no repository credentials', () => {
    const serialized = JSON.stringify(repositoriesForArtifact([repository]));
    assert.equal(serialized.includes('artifact-user'), false);
    assert.equal(serialized.includes('highly-secret'), false);
    assert.equal(JSON.parse(serialized)[0].gpgCheck, true);
});

test('RPM command output and errors redact every credential occurrence', () => {
    const output = redactSecrets(
        'request by artifact-user failed: highly-secret; retry highly-secret',
        [repository.username, repository.password],
    );
    assert.equal(output, 'request by [REDACTED] failed: [REDACTED]; retry [REDACTED]');
});

test('Docker upload locations stay on the configured registry origin', () => {
    const result = new URL(resolveDockerUploadLocation(
        'https://attacker.example/v2/project/blobs/uploads/id?state=opaque#fragment',
        'https://nexus.example/repository/docker-hosted',
    ));
    assert.equal(result.origin, 'https://nexus.example');
    assert.equal(result.pathname, '/repository/docker-hosted/v2/project/blobs/uploads/id');
    assert.equal(result.search, '?state=opaque');
    assert.equal(result.hash, '');

    const relative = new URL(resolveDockerUploadLocation(
        'v2/project/blobs/uploads/relative-id',
        'https://nexus.example/repository/docker-hosted',
    ));
    assert.equal(relative.pathname, '/repository/docker-hosted/v2/project/blobs/uploads/relative-id');
});
