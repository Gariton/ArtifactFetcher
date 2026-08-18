import assert from 'node:assert/strict';
import test from 'node:test';
import { getEnvironmentVar } from '../src/components/actions';
import { resolveDockerUploadLocation } from '../src/lib/docker/registryPusher';
import { redactSecrets, repositoriesForArtifact, type RpmRepository } from '../src/lib/rpm/downloader';

test('client environment action never returns upload credentials', async () => {
    const result = await getEnvironmentVar();
    const keys = Object.keys(result);
    for (const key of keys) {
        assert.doesNotMatch(key, /(?:PASSWORD|USERNAME|AUTH_TOKEN|UPLOAD_TOKEN)$/);
    }
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
