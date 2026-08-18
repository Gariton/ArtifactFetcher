import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
    assertDockerRepository,
    assertDockerTag,
    assertHfRepoId,
    isValidJobId,
    resolveWithin,
    safeBundleName,
    safeHfRevisionDirectory,
} from '../src/lib/inputSafety';

test('safeBundleName converts traversal and separators to one component', () => {
    const value = safeBundleName('../../private\\secret', 'bundle');
    assert.equal(value.includes('/'), false);
    assert.equal(value.includes('\\'), false);
    assert.equal(value.includes('..'), false);
    assert.notEqual(value, '');
});

test('resolveWithin accepts nested files and rejects escapes', () => {
    const root = path.resolve('/tmp/artifact-fetcher-test');
    assert.equal(resolveWithin(root, 'models/model.gguf'), path.join(root, 'models', 'model.gguf'));
    assert.throws(() => resolveWithin(root, '../secret'), /unsafe relative path|escapes/);
    assert.throws(() => resolveWithin(root, 'models/../../secret'), /unsafe relative path|escapes/);
    assert.throws(() => resolveWithin(root, '/etc/passwd'), /unsafe relative path/);
    assert.throws(() => resolveWithin(root, '..\\secret'), /unsafe relative path/);
});

test('Docker and Hugging Face identifiers are validated for their remote grammar', () => {
    assert.equal(assertDockerTag('v1.2-rc1'), 'v1.2-rc1');
    assert.throws(() => assertDockerTag('../../latest'), /valid Docker tag/);
    assert.equal(assertDockerRepository('team/image'), 'team/image');
    assert.throws(() => assertDockerRepository('../image'), /valid lowercase Docker repository/);
    assert.equal(assertHfRepoId('openai/example-model'), 'openai/example-model');
    assert.throws(() => assertHfRepoId('../../etc'), /valid Hugging Face repository/);
    assert.equal(safeHfRevisionDirectory('refs/pr/123').includes('/'), false);
});

test('only standard nanoid job ids are accepted', () => {
    assert.equal(isValidJobId('Abcd_efgh-12345678901'), true);
    assert.equal(isValidJobId('../../arbitrary'), false);
    assert.equal(isValidJobId('short'), false);
});
