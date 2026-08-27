import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_DOCKER_TAGS_PER_IMAGE, parseDockerUploadTargets, resolveDockerUploadTarget } from '../src/lib/docker/uploadTargets';

test('Docker upload targets are parsed one-to-one with uploaded files', () => {
    const targets = parseDockerUploadTargets(JSON.stringify([
        { useManifest: true, repository: '', tags: ['latest', 'stable'] },
        { useManifest: false, repository: 'team/api', tags: ['2.0', 'latest'] },
    ]), 2);

    assert.deepEqual(targets, [
        { useManifest: true, repository: '', tags: ['latest', 'stable'] },
        { useManifest: false, repository: 'team/api', tags: ['2.0', 'latest'] },
    ]);
    assert.throws(
        () => parseDockerUploadTargets(JSON.stringify(targets), 1),
        /one upload target is required for each file/,
    );
    assert.throws(
        () => parseDockerUploadTargets(JSON.stringify([
            { useManifest: true, tags: Array.from({ length: MAX_DOCKER_TAGS_PER_IMAGE + 1 }, (_, index) => `tag-${index}`) },
        ]), 1),
        /tag limit/,
    );
});

test('manifest targets retain the manifest tag and add unique tags', () => {
    const resolved = resolveDockerUploadTarget(
        { useManifest: true, tags: ['latest', 'stable', '1.2'] },
        { Config: 'config.json', Layers: ['layer.tar'], RepoTags: ['team/api:1.2'] },
    );

    assert.deepEqual(resolved, {
        repository: 'team/api',
        tags: ['1.2', 'latest', 'stable'],
    });
});

test('custom targets accept multiple tags and reject invalid input', () => {
    assert.deepEqual(
        resolveDockerUploadTarget({ useManifest: false, repository: 'team/worker', tags: ['2.0', 'stable'] }),
        { repository: 'team/worker', tags: ['2.0', 'stable'] },
    );
    assert.throws(
        () => resolveDockerUploadTarget({ useManifest: false, repository: 'Team/Worker', tags: ['stable'] }),
        /valid lowercase Docker repository/,
    );
    assert.throws(
        () => resolveDockerUploadTarget({ useManifest: false, repository: 'team/worker', tags: [] }),
        /at least one tag/,
    );
});
