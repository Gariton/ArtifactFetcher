import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';

export type LoadManifestEntry = {
    Config: string;
    RepoTags: string[];
    Layers: string[];
};

/** docker load 形式の tar から manifest.json を取り出して最初のエントリを返す */
export async function readLoadManifestFromTar(tarPath: string): Promise<LoadManifestEntry | null> {
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mf-'));
    // manifest.json だけ展開（他は展開しない）
    try {
        await tar.x({
            file: tarPath,
            cwd: work,
            sync: true,
            filter: (p) => {
                // 例: './manifest.json' → 'manifest.json'
                const norm = p.replace(/^(\.\/)+/, '');
                // 例: 'foo/bar/manifest.json' も許可
                return norm === 'manifest.json' || /(^|\/)manifest\.json$/.test(norm);
            }
        });
    } catch {
        // manifest.json が無い tar の場合
    }
    const mf = path.join(work, 'manifest.json');
    if (!fs.existsSync(mf)) return null;
    const arr = JSON.parse(await fs.promises.readFile(mf, 'utf8')) as LoadManifestEntry[];
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
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