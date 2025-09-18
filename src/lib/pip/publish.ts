import { spawn } from 'node:child_process';

const PYTHON_BIN = process.env.PIP_PYTHON_BIN || 'python3';

type RunOptions = {
    forwardOutput?: boolean;
};

type RunResult = {
    code: number;
    stdout: string;
    stderr: string;
};

function runPython(args: string[], { forwardOutput = false }: RunOptions = {}): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
        const child = spawn(PYTHON_BIN, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                TWINE_NON_INTERACTIVE: '1',
            },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            if (forwardOutput) process.stdout.write(chunk);
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            if (forwardOutput) process.stderr.write(chunk);
            stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
}

let twineChecked = false;

async function ensureTwineAvailable() {
    if (twineChecked) return;
    const result = await runPython(['-m', 'twine', '--version']);
    if (result.code !== 0) {
        throw new Error(`twine is not available. Install it with "pip install --upgrade twine". Details: ${result.stderr || result.stdout}`);
    }
    twineChecked = true;
}

export type PipUploadOptions = {
    filePath: string;
    repositoryUrl: string;
    username?: string;
    password?: string;
    token?: string;
    skipExisting?: boolean;
    extraArgs?: string[];
};

export async function uploadDistribution({ filePath, repositoryUrl, username, password, token, skipExisting = false, extraArgs = [] }: PipUploadOptions) {
    if (!repositoryUrl) throw new Error('repositoryUrl is required');
    if (!filePath) throw new Error('filePath is required');

    await ensureTwineAvailable();

    const args = ['-m', 'twine', 'upload', filePath, '--repository-url', repositoryUrl, '--non-interactive', '--disable-progress-bar'];
    if (skipExisting) args.push('--skip-existing');
    if (token) {
        args.push('-u', '__token__', '-p', token);
    } else {
        if (username) args.push('-u', username);
        if (password) args.push('-p', password);
    }
    if (extraArgs.length) args.push(...extraArgs);

    const result = await runPython(args, { forwardOutput: true });
    if (result.code !== 0) {
        throw new Error((result.stderr || result.stdout || '').trim() || 'twine upload failed');
    }
}
