import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { ProgressBus, type HfFile } from '@/lib/progressBus';

type HfSibling = {
    rfilename: string;
    size?: number;
};

type HfDownloadOptions = {
    repoId: string;
    revision?: string;
    bundleName?: string;
    includePatterns?: string[];
    excludePatterns?: string[];
    token?: string;
    bus: ProgressBus;
};

function toSafeBundleName(input: string) {
    return input
        .replace(/[^a-zA-Z0-9._@-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'hf-model';
}

function wildcardToRegExp(pattern: string) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

function matchAnyPattern(target: string, patterns: string[]) {
    if (!patterns.length) return true;
    return patterns.some((pattern) => wildcardToRegExp(pattern).test(target));
}

async function fetchModelFileList(repoId: string, token?: string): Promise<HfSibling[]> {
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`https://huggingface.co/api/models/${encodeURIComponent(repoId)}?expand[]=siblings`, {
        headers,
        cache: 'no-store',
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Hugging Face API error (${res.status}): ${detail || 'failed to fetch model metadata'}`);
    }

    const payload = await res.json() as { siblings?: HfSibling[] };
    return Array.isArray(payload.siblings) ? payload.siblings : [];
}

async function downloadSingleFile({ repoId, revision, token, relativePath, outPath, bus, index, total }: {
    repoId: string;
    revision: string;
    token?: string;
    relativePath: string;
    outPath: string;
    bus: ProgressBus;
    index: number;
    total?: number;
}) {
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const encodedFilePath = relativePath.split('/').map((part) => encodeURIComponent(part)).join('/');
    const url = `https://huggingface.co/${repoId}/resolve/${encodeURIComponent(revision)}/${encodedFilePath}?download=true`;

    bus.emitEvent({ type: 'item-start', scope: 'hf-download', index, digest: relativePath, total });

    const res = await fetch(url, { headers, redirect: 'follow', cache: 'no-store' });
    if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new Error(`failed to download ${relativePath}: ${res.status} ${detail}`);
    }

    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    const stream = fs.createWriteStream(outPath);
    const reader = res.body.getReader();

    let received = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        stream.write(Buffer.from(value));
        received += value.byteLength;
        bus.emitEvent({ type: 'item-progress', scope: 'hf-download', index, received, total });
    }

    await new Promise<void>((resolve, reject) => {
        stream.end(() => resolve());
        stream.on('error', reject);
    });

    bus.emitEvent({ type: 'item-done', scope: 'hf-download', index });
}

export async function buildHfBundle({
    repoId,
    revision = 'main',
    bundleName,
    includePatterns = ['*.gguf', '*.json', 'tokenizer*', '*.model'],
    excludePatterns = [],
    token,
    bus,
}: HfDownloadOptions) {
    if (!repoId.trim()) throw new Error('repoId is required');

    bus.emitEvent({ type: 'stage', stage: 'hf-resolve-model' });
    const siblings = await fetchModelFileList(repoId, token);

    const files = siblings
        .filter((item) => !!item.rfilename)
        .filter((item) => matchAnyPattern(item.rfilename, includePatterns))
        .filter((item) => !matchAnyPattern(item.rfilename, excludePatterns));

    if (!files.length) {
        throw new Error('download target files are empty. Please check include / exclude patterns.');
    }

    const manifest: HfFile[] = files.map((item) => ({
        path: item.rfilename,
        size: item.size,
    }));
    bus.emitEvent({ type: 'manifest-resolved', items: manifest });

    const resolvedBundleName = toSafeBundleName(bundleName?.trim() || `${repoId.replace('/', '--')}@${revision}`);
    const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hfdl-'));
    const bundleRoot = path.join(workRoot, resolvedBundleName, 'huggingface');
    const modelRoot = path.join(bundleRoot, 'models', repoId.replace('/', '--'), revision);
    await fs.promises.mkdir(modelRoot, { recursive: true });

    bus.emitEvent({ type: 'stage', stage: 'hf-download' });
    for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const outPath = path.join(modelRoot, file.rfilename);
        await downloadSingleFile({
            repoId,
            revision,
            token,
            relativePath: file.rfilename,
            outPath,
            bus,
            index: i,
            total: file.size,
        });
    }

    const guide = `# Hugging Face Model Bundle\n\n- Repository: ${repoId}\n- Revision: ${revision}\n- Files: ${files.length}\n\n## Example: run with Ollama\n\n1. Pick a downloaded ".gguf" file path in this archive.\n2. Create Modelfile:\n\n\`\`\`\nFROM ./path/to/model.gguf\n\`\`\`\n\n3. Build and run:\n\n\`\`\`bash\nollama create local-${resolvedBundleName} -f Modelfile\nollama run local-${resolvedBundleName}\n\`\`\`\n`;
    await fs.promises.writeFile(path.join(bundleRoot, 'README-OLLAMA.md'), guide, 'utf8');
    await fs.promises.writeFile(path.join(bundleRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    bus.emitEvent({ type: 'tar-writing' });
    const filename = `${resolvedBundleName}.tar`;
    const tarPath = path.join(workRoot, filename);
    await tar.c({ cwd: path.join(workRoot, resolvedBundleName), file: tarPath, sync: true }, ['.']);
    bus.emitEvent({ type: 'done', filename });

    return { tarPath, filename, workRoot, manifest };
}
