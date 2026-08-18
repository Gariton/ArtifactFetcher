import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as tar from 'tar';
import { extractDockerArchive, normalizeDockerRegistryUrl } from '../src/lib/docker/registryPusher';
import { MAX_DOCKER_MANIFEST_BYTES, readLoadManifestFromTar } from '../src/lib/docker/readDockerLoadManifest';
import { normalizeNpmRegistryUrl } from '../src/lib/npm/publish';
import { assertRpmSpec, normalizeRpmBaseUrl } from '../src/lib/rpm/downloader';
import { normalizeRpmRepositoryUrl } from '../src/lib/rpm/publish';
import { normalizePipRepositoryUrl } from '../src/lib/pip/publish';
import { assertPipSpec, normalizePipIndexUrls } from '../src/lib/pip/downloader';
import { makeArtifactObjectKey } from '../src/lib/storage/s3';

test('upload targets reject local schemes, embedded credentials, and plaintext credential transport', () => {
    assert.throws(() => normalizeRpmRepositoryUrl('file:///tmp/target'), /HTTP or HTTPS/);
    assert.throws(() => normalizeRpmRepositoryUrl('https://user:pass@example.test/repository/'), /must not contain credentials/);
    assert.throws(() => normalizeRpmRepositoryUrl('http://example.test/repository/', true), /require an HTTPS/);
    assert.throws(() => normalizeRpmBaseUrl('https://user:pass@example.test/repository/'), /must not contain credentials/);
    assert.throws(() => normalizeNpmRegistryUrl('http://example.test/repository/npm/', true), /require an HTTPS/);
    assert.throws(() => normalizePipRepositoryUrl('file:///tmp/target'), /HTTP\(S\)/);
    assert.throws(() => normalizeDockerRegistryUrl('http://example.test/', true), /require an HTTPS/);
});

test('RPM package specifications cannot become dnf options', () => {
    assert.equal(assertRpmSpec('bash-5.1.8-9.el9.x86_64'), 'bash-5.1.8-9.el9.x86_64');
    assert.throws(() => assertRpmSpec('--nogpgcheck'), /invalid RPM package specification/);
    assert.throws(() => assertRpmSpec('--setopt=gpgcheck=0'), /invalid RPM package specification/);
    assert.throws(() => assertRpmSpec('https://internal.example/package.rpm'), /invalid RPM package specification/);
});

test('pip package specifications cannot select arbitrary code or local paths', () => {
    assert.equal(assertPipSpec('requests[security]>=2.32; python_version >= "3.10"'), 'requests[security]>=2.32; python_version >= "3.10"');
    assert.throws(() => assertPipSpec('--extra-index-url=https://internal.example'), /invalid pip package specification/);
    assert.throws(() => assertPipSpec('project @ https://internal.example/project.whl'), /invalid pip package specification/);
    assert.throws(() => assertPipSpec('../local-project'), /invalid pip package specification/);
});

test('pip credentials are scoped to the configured index origin', () => {
    const indexes = normalizePipIndexUrls(
        'https://private.example/simple',
        ['https://private.example/mirror', 'https://pypi.org/simple'],
        'alice',
        'secret',
    );
    assert.equal(new URL(indexes.indexUrl!).username, 'alice');
    assert.equal(new URL(indexes.extraIndexUrls[0]).username, 'alice');
    assert.equal(new URL(indexes.extraIndexUrls[1]).username, '');
});

test('Docker archive extraction rejects symbolic links', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-fetcher-link-test-'));
    try {
        const source = path.join(root, 'source');
        await fs.mkdir(source);
        await fs.symlink('/etc/passwd', path.join(source, 'layer.tar'));
        const archive = path.join(root, 'image.tar');
        await tar.c({ cwd: source, file: archive }, ['layer.tar']);
        await assert.rejects(extractDockerArchive(archive), /link or special entry/);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('Docker manifest parsing rejects oversized metadata before reading it into memory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-fetcher-manifest-limit-'));
    try {
        const source = path.join(root, 'source');
        await fs.mkdir(source);
        await fs.writeFile(path.join(source, 'manifest.json'), Buffer.alloc(MAX_DOCKER_MANIFEST_BYTES + 1, 0x20));
        const archive = path.join(root, 'image.tar');
        await tar.c({ cwd: source, file: archive }, ['manifest.json']);
        assert.equal(await readLoadManifestFromTar(archive), null);
        await assert.rejects(extractDockerArchive(archive), /manifest exceeds/);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('S3 artifact keys stay inside the dedicated prefix', () => {
    const previous = process.env.S3_OBJECT_PREFIX;
    try {
        process.env.S3_OBJECT_PREFIX = 'artifact-fetcher/';
        assert.equal(
            makeArtifactObjectKey('123456789012345678901', '../bundle.tar'),
            'artifact-fetcher/123456789012345678901/.._bundle.tar',
        );
    } finally {
        if (previous === undefined) delete process.env.S3_OBJECT_PREFIX;
        else process.env.S3_OBJECT_PREFIX = previous;
    }
});
