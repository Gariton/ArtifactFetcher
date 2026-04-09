import { spawn } from 'node:child_process';

export type RpmUploadMethod = 'put' | 'post';

export type UploadRpmOptions = {
    filePath: string;
    repositoryUrl: string;
    method?: RpmUploadMethod;
    username?: string;
    password?: string;
    token?: string;
};

export async function uploadRpmFile({ filePath, repositoryUrl, method = 'put', username, password, token }: UploadRpmOptions) {
    const normalizedBase = repositoryUrl.endsWith('/') ? repositoryUrl : `${repositoryUrl}/`;
    const filename = filePath.split('/').pop() || 'package.rpm';
    const targetUrl = `${normalizedBase}${encodeURIComponent(filename)}`;

    const args: string[] = ['--silent', '--show-error', '--fail', '--location', '-X', method.toUpperCase()];

    if (token) {
        args.push('-H', `Authorization: Bearer ${token}`);
    } else if (username || password) {
        args.push('-u', `${username || ''}:${password || ''}`);
    }

    if (method === 'post') {
        args.push('-H', 'Content-Type: application/x-rpm', '--data-binary', `@${filePath}`);
    } else {
        args.push('--upload-file', filePath);
    }

    args.push(targetUrl);

    const result = await new Promise<{ code: number; stderr: string; stdout: string }>((resolve, reject) => {
        const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code: code ?? -1, stderr, stdout }));
    });

    if (result.code !== 0) {
        throw new Error((result.stderr || result.stdout || 'rpm upload failed').trim());
    }
}
