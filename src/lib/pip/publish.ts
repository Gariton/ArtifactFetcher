import { spawn } from 'node:child_process';

const PYTHON_BIN = process.env.PIP_PYTHON_BIN || 'python3';

type RunOptions = {
    forwardOutput?: boolean;
    env?: Record<string, string | undefined>;
};

type RunResult = {
    code: number;
    stdout: string;
    stderr: string;
};

function runPython(args: string[], { forwardOutput = false, env }: RunOptions = {}): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
        const child = spawn(PYTHON_BIN, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                TWINE_NON_INTERACTIVE: '1',
                ...(env || {}),
            },
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const append = (current: string, chunk: unknown) => `${current}${String(chunk)}`.slice(-1024 * 1024);
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, 5 * 60_000);
        timeout.unref?.();
        child.stdout.on('data', (chunk) => {
            if (forwardOutput) process.stdout.write(chunk);
            stdout = append(stdout, chunk);
        });
        child.stderr.on('data', (chunk) => {
            if (forwardOutput) process.stderr.write(chunk);
            stderr = append(stderr, chunk);
        });
        child.on('error', (error) => { clearTimeout(timeout); reject(error); });
        child.on('close', (code) => {
            clearTimeout(timeout);
            resolve({ code: timedOut ? -1 : (code ?? -1), stdout, stderr: timedOut ? `${stderr}\ntwine upload timed out` : stderr });
        });
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
    certPath?: string;
};

export function normalizePipRepositoryUrl(repositoryUrl: string, hasCredentials = false): string {
    let url: URL;
    try { url = new URL(repositoryUrl.trim()); }
    catch { throw new Error('pip repository URL is invalid'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('pip repository URL must be HTTP(S) without credentials, query, or fragment');
    }
    if (hasCredentials && url.protocol !== 'https:') {
        throw new Error('pip upload credentials require an HTTPS repository URL');
    }
    return url.toString();
}

export async function uploadDistribution({ filePath, repositoryUrl, username, password, token, skipExisting = false, extraArgs = [], certPath }: PipUploadOptions) {
    if (!repositoryUrl) throw new Error('repositoryUrl is required');
    if (!filePath) throw new Error('filePath is required');

    const normalizedRepository = normalizePipRepositoryUrl(repositoryUrl, Boolean(token || username || password));

    await ensureTwineAvailable();

    const args = ['-m', 'twine', 'upload', filePath, '--repository-url', normalizedRepository, '--non-interactive', '--disable-progress-bar'];
    if (skipExisting) args.push('--skip-existing');
    if (certPath) {
        args.push('--cert', certPath);
    }
    if (extraArgs.length) args.push(...extraArgs);

    const extraEnv = {
        ...(certPath ? { REQUESTS_CA_BUNDLE: certPath } : {}),
        ...(token ? { TWINE_USERNAME: '__token__', TWINE_PASSWORD: token } : {}),
        ...(!token && username ? { TWINE_USERNAME: username } : {}),
        ...(!token && password ? { TWINE_PASSWORD: password } : {}),
    };
    const result = await runPython(args, { env: extraEnv });
    if (result.code !== 0) {
        let details = (result.stderr || result.stdout || '').trim();
        for (const secret of [token, username, password].filter((value): value is string => Boolean(value))) {
            details = details.split(secret).join('[REDACTED]');
        }
        throw new Error(details || 'twine upload failed');
    }
}
