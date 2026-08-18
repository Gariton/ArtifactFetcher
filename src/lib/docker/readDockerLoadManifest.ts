import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';

export type LoadManifestEntry = {
    Config: string;
    RepoTags: string[];
    Layers: string[];
};

export const MAX_DOCKER_MANIFEST_BYTES = 1024 * 1024;

/** docker load 形式の tar から manifest.json を取り出して最初のエントリを返す */
export async function readLoadManifestFromTar(tarPath: string): Promise<LoadManifestEntry | null> {
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mf-'));
    try {
        let validationError = false;
        // Only extract the docker-load root manifest. Accepting a nested manifest and
        // then looking up a different path made cleanup/error handling inconsistent.
        await tar.x({
            file: tarPath,
            cwd: work,
            strict: true,
            filter: (entryPath, entry) => {
                const isManifest = entryPath.replace(/^(\.\/)+/, '') === 'manifest.json';
                if (!isManifest) return false;
                const entryType = entry && 'type' in entry ? entry.type : undefined;
                if (!entryType || !['File', 'OldFile'].includes(entryType) || Number(entry.size || 0) > MAX_DOCKER_MANIFEST_BYTES) {
                    validationError = true;
                    return false;
                }
                return true;
            },
        });
        if (validationError) return null;
        const mf = path.join(work, 'manifest.json');
        if (!fs.existsSync(mf)) return null;
        const stat = await fs.promises.lstat(mf);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DOCKER_MANIFEST_BYTES) return null;
        const arr = JSON.parse(await fs.promises.readFile(mf, 'utf8')) as LoadManifestEntry[];
        return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
    } catch {
        return null;
    } finally {
        try { await fs.promises.rm(work, { recursive: true, force: true }); } catch {}
    }
}

/** RepoTags から repository と tag を取り出す（最初の1個を採用） */
export function repoTagFromRepoTags(repoTags?: string[]): { repository?: string; tag?: string } {
    if (!repoTags || repoTags.length === 0) return {};
    const first = repoTags[0]; // 例: "library/redis:7.2"
    const i = first.lastIndexOf(':');
    if (i <= 0) return { repository: first.toLowerCase() };
    const repository = first.slice(0, i).toLowerCase();
    const tag = first.slice(i + 1);
    return { repository, tag };
}
