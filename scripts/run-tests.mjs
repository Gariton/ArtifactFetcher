import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

async function collectTests(directory) {
    const files = [];
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (error?.code === 'ENOENT') return files;
        throw error;
    }

    for (const entry of entries) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectTests(target));
        } else if (entry.isFile() && /\.test\.ts$/.test(entry.name)) {
            files.push(target);
        }
    }
    return files;
}

const testFiles = [
    ...await collectTests(path.resolve('src')),
    ...await collectTests(path.resolve('tests')),
].sort();

if (testFiles.length === 0) {
    console.error('No test files were found.');
    process.exit(1);
}

const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...testFiles], {
    stdio: 'inherit',
});

child.once('error', (error) => {
    console.error(error);
    process.exit(1);
});
child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
});
