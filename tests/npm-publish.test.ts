import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import * as tar from 'tar';
import { publishTarball } from '../src/lib/npm/publish';

async function makeTarball(root: string, version: string): Promise<string> {
    const source = path.join(root, `source-${version}`);
    const packageDir = path.join(source, 'package');
    const tarball = path.join(root, `example-${version}.tgz`);
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
        name: '@example/pkg',
        version,
    }));
    await tar.c({ cwd: source, file: tarball, gzip: true }, ['package']);
    return tarball;
}

async function setFakeDigests(tarball: string) {
    const bytes = await fs.readFile(tarball);
    process.env.NPM_FAKE_INTEGRITY = `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;
    process.env.NPM_FAKE_SHASUM = crypto.createHash('sha1').update(bytes).digest('hex');
}

test('npm publish is immutable and never unpublishes an existing package version', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-fetcher-npm-test-'));
    const fakeBin = path.join(root, 'bin');
    const logPath = path.join(root, 'npm-commands.jsonl');
    const originalPath = process.env.PATH;
    const originalMode = process.env.NPM_FAKE_MODE;
    const originalLog = process.env.NPM_FAKE_LOG;
    const originalIntegrity = process.env.NPM_FAKE_INTEGRITY;
    const originalShasum = process.env.NPM_FAKE_SHASUM;

    try {
        await fs.mkdir(fakeBin);
        const fakeNpm = path.join(fakeBin, 'npm');
        await fs.writeFile(fakeNpm, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.NPM_FAKE_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'unpublish') process.exit(90);
if (args[0] === 'view') {
  if (process.env.NPM_FAKE_MODE === 'exists') {
    fs.writeSync(1, JSON.stringify({ integrity: process.env.NPM_FAKE_INTEGRITY, shasum: process.env.NPM_FAKE_SHASUM }));
    process.exit(0);
  }
  if (process.env.NPM_FAKE_MODE === 'lookup-error') {
    fs.writeSync(2, 'authentication failed\\n' + fs.readFileSync(process.env.npm_config_userconfig, 'utf8'));
    process.exit(1);
  }
  if (process.env.NPM_FAKE_MODE === 'publish-race') {
    const callCount = fs.readFileSync(process.env.NPM_FAKE_LOG, 'utf8').trim().split('\\n').length;
    if (callCount > 2) {
      fs.writeSync(1, JSON.stringify({ integrity: process.env.NPM_FAKE_INTEGRITY, shasum: process.env.NPM_FAKE_SHASUM }));
      process.exit(0);
    }
  }
  fs.writeSync(2, 'npm error code E404\\nnpm error 404 Not Found');
  process.exit(1);
}
if (args[0] === 'publish') {
  if (process.env.NPM_FAKE_MODE === 'publish-race') {
    fs.writeSync(2, 'npm error code E409\\nnpm error 409 Conflict');
    process.exit(1);
  }
  process.exit(0);
}
process.exit(2);
`, { mode: 0o755 });

        process.env.PATH = `${fakeBin}:${originalPath || ''}`;
        process.env.NPM_FAKE_LOG = logPath;

        process.env.NPM_FAKE_MODE = 'exists';
        const existingTarball = await makeTarball(root, '1.0.0');
        await setFakeDigests(existingTarball);
        const existing = await publishTarball({
            tarballPath: existingTarball,
            registry: 'https://nexus.example/repository/npm-hosted',
            authToken: 'token-secret',
        });
        assert.deepEqual(existing, { packageId: '@example/pkg@1.0.0', status: 'skipped' });
        let commands = (await fs.readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
        assert.deepEqual(commands.map(([command]) => command), ['view']);

        await fs.writeFile(logPath, '');
        // Prefer SHA-512 integrity when present; a matching legacy SHA-1 alone is
        // insufficient if the stronger digest says the content differs.
        process.env.NPM_FAKE_INTEGRITY = 'sha512-conflicting-content';
        await assert.rejects(
            publishTarball({
                tarballPath: existingTarball,
                registry: 'https://nexus.example/repository/npm-hosted',
                authToken: 'token-secret',
            }),
            /already exists with different package content/,
        );

        // A 404 for the requested version is expected even when older package versions exist.
        // Publishing the new version must not remove or rewrite any existing package content.
        await fs.writeFile(logPath, '');
        process.env.NPM_FAKE_MODE = 'older-version-only';
        const newVersion = await publishTarball({
            tarballPath: await makeTarball(root, '2.0.0'),
            registry: 'https://nexus.example/repository/npm-hosted/',
            username: 'publisher',
            password: 'password-secret',
        });
        assert.deepEqual(newVersion, { packageId: '@example/pkg@2.0.0', status: 'published' });
        commands = (await fs.readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
        assert.deepEqual(commands.map(([command]) => command), ['view', 'publish']);
        assert.equal(commands.some(([command]) => command === 'unpublish'), false);

        // A concurrent publisher may create the version between preflight and publish. Rechecking
        // turns that conflict into an idempotent skip without deleting the winner's package.
        await fs.writeFile(logPath, '');
        process.env.NPM_FAKE_MODE = 'publish-race';
        const racedTarball = await makeTarball(root, '2.1.0');
        await setFakeDigests(racedTarball);
        const raced = await publishTarball({
            tarballPath: racedTarball,
            registry: 'https://nexus.example/repository/npm-hosted/',
            authToken: 'token-secret',
        });
        assert.deepEqual(raced, { packageId: '@example/pkg@2.1.0', status: 'skipped' });
        commands = (await fs.readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
        assert.deepEqual(commands.map(([command]) => command), ['view', 'publish', 'view']);
        assert.equal(commands.some(([command]) => command === 'unpublish'), false);

        await fs.writeFile(logPath, '');
        process.env.NPM_FAKE_MODE = 'lookup-error';
        await assert.rejects(
            publishTarball({
                tarballPath: await makeTarball(root, '3.0.0'),
                registry: 'https://nexus.example/repository/npm-hosted/',
                authToken: 'token-secret',
            }),
            (error: unknown) => {
                assert(error instanceof Error);
                assert.match(error.message, /npm registry check failed/);
                assert.doesNotMatch(error.message, /token-secret/);
                assert.match(error.message, /\[REDACTED\]/);
                return true;
            },
        );
        commands = (await fs.readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
        assert.deepEqual(commands.map(([command]) => command), ['view']);
    } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        if (originalMode === undefined) delete process.env.NPM_FAKE_MODE;
        else process.env.NPM_FAKE_MODE = originalMode;
        if (originalLog === undefined) delete process.env.NPM_FAKE_LOG;
        else process.env.NPM_FAKE_LOG = originalLog;
        if (originalIntegrity === undefined) delete process.env.NPM_FAKE_INTEGRITY;
        else process.env.NPM_FAKE_INTEGRITY = originalIntegrity;
        if (originalShasum === undefined) delete process.env.NPM_FAKE_SHASUM;
        else process.env.NPM_FAKE_SHASUM = originalShasum;
        await fs.rm(root, { recursive: true, force: true });
    }
});
