import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import { ProgressBus, type HfFile } from '@/lib/progressBus';
import { assertHfRepoId, resolveWithin, safeBundleName, safeFilenamePart, safeHfRevisionDirectory } from '@/lib/inputSafety';
import { assertFileSize, assertItemCount, ByteBudget } from '@/lib/resourceLimits';

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

function wildcardToRegExp(pattern: string) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

function matchAnyPattern(target: string, patterns: string[]) {
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

async function downloadSingleFile({ repoId, revision, token, relativePath, outPath, bus, index, total, budget }: {
    repoId: string;
    revision: string;
    token?: string;
    relativePath: string;
    outPath: string;
    bus: ProgressBus;
    index: number;
    total?: number;
    budget: ByteBudget;
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

    assertFileSize(total, `Hugging Face file ${relativePath}`);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    let received = 0;
    const limiter = new Transform({
        transform(chunk: Buffer | string, _encoding, callback) {
            const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
            try {
                received += bytes;
                assertFileSize(received, `Hugging Face file ${relativePath}`);
                budget.consume(bytes);
                bus.emitEvent({ type: 'item-progress', scope: 'hf-download', index, received, total });
                callback(null, chunk);
            } catch (error) {
                callback(error as Error);
            }
        },
    });
    await pipeline(Readable.fromWeb(res.body as any), limiter, fs.createWriteStream(outPath));

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
    const normalizedRepoId = assertHfRepoId(repoId);
    const normalizedRevision = String(revision || 'main').trim();
    if (!normalizedRevision || normalizedRevision.length > 255 || normalizedRevision.includes('\0')) {
        throw new Error('revision is invalid or too long');
    }

    bus.emitEvent({ type: 'stage', stage: 'hf-resolve-model' });
    const siblings = await fetchModelFileList(normalizedRepoId, token);

    const files = siblings
        .filter((item) => !!item.rfilename)
        .filter((item) => !includePatterns.length || matchAnyPattern(item.rfilename, includePatterns))
        .filter((item) => !matchAnyPattern(item.rfilename, excludePatterns));

    if (!files.length) {
        throw new Error('download target files are empty. Please check include / exclude patterns.');
    }
    assertItemCount(files.length, 'Hugging Face file');
    for (const file of files) assertFileSize(file.size, `Hugging Face file ${file.rfilename}`);

    const manifest: HfFile[] = files.map((item) => ({
        path: item.rfilename,
        size: item.size,
    }));
    bus.emitEvent({ type: 'manifest-resolved', items: manifest });

    const resolvedBundleName = safeBundleName(bundleName?.trim() || `${normalizedRepoId.replace('/', '--')}@${normalizedRevision}`, 'hf-model');
    const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hfdl-'));
    try {
        const bundleRoot = path.join(workRoot, resolvedBundleName, 'huggingface');
        const repoDirectory = safeFilenamePart(normalizedRepoId.replace('/', '--'), 'model');
        const revisionDirectory = safeHfRevisionDirectory(normalizedRevision);
        const modelRoot = path.join(bundleRoot, 'models', repoDirectory, revisionDirectory);
        await fs.promises.mkdir(modelRoot, { recursive: true });
        const budget = new ByteBudget();

        bus.emitEvent({ type: 'stage', stage: 'hf-download' });
        for (let i = 0; i < files.length; i += 1) {
            const file = files[i];
            const outPath = resolveWithin(modelRoot, file.rfilename);
            await downloadSingleFile({
                repoId: normalizedRepoId,
                revision: normalizedRevision,
                token,
                relativePath: file.rfilename,
                outPath,
                bus,
                index: i,
                total: file.size,
                budget,
            });
        }

        const guide = `# Hugging Face Model Bundle\n\n- Repository: ${normalizedRepoId}\n- Revision: ${normalizedRevision}\n- Files: ${files.length}\n\n## Example: run with Ollama\n\n1. Pick a downloaded ".gguf" file path in this archive.\n2. Create Modelfile:\n\n\`\`\`\nFROM ./path/to/model.gguf\n\`\`\`\n\n3. Build and run:\n\n\`\`\`bash\nollama create local-${resolvedBundleName} -f Modelfile\nollama run local-${resolvedBundleName}\n\`\`\`\n`;
        await fs.promises.writeFile(path.join(bundleRoot, 'README-OLLAMA.md'), guide, 'utf8');
        await fs.promises.writeFile(path.join(bundleRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

        bus.emitEvent({ type: 'tar-writing' });
        const filename = `${resolvedBundleName}.tar`;
        const tarPath = path.join(workRoot, filename);
        await tar.c({ cwd: path.join(workRoot, resolvedBundleName), file: tarPath }, ['.']);

        return { tarPath, filename, workRoot, manifest };
    } catch (error) {
        try { await fs.promises.rm(workRoot, { recursive: true, force: true }); } catch {}
        throw error;
    }
}
