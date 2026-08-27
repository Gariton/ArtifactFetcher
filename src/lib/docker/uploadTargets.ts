import { assertDockerRepository, assertDockerTag } from '@/lib/inputSafety';
import { repoTagFromRepoTags, type LoadManifestEntry } from '@/lib/docker/readDockerLoadManifest';

export type DockerUploadTarget = {
    useManifest: boolean;
    repository?: string;
    tags: string[];
};

export type ResolvedDockerUploadTarget = {
    repository: string;
    tags: string[];
};

export const MAX_DOCKER_TAGS_PER_IMAGE = 32;

function uniqueTags(tags: unknown[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const rawTag of tags) {
        const tag = assertDockerTag(rawTag);
        if (!seen.has(tag)) {
            seen.add(tag);
            result.push(tag);
        }
    }
    return result;
}

export function parseDockerUploadTargets(raw: string, expectedCount: number): DockerUploadTarget[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('targets must be valid JSON');
    }
    if (!Array.isArray(parsed) || parsed.length !== expectedCount) {
        throw new Error('one upload target is required for each file');
    }

    return parsed.map((value, index) => {
        if (!value || typeof value !== 'object') throw new Error(`target ${index + 1} is invalid`);
        const candidate = value as Record<string, unknown>;
        if (typeof candidate.useManifest !== 'boolean' || !Array.isArray(candidate.tags)) {
            throw new Error(`target ${index + 1} is invalid`);
        }
        if (!candidate.tags.every((tag) => typeof tag === 'string')) {
            throw new Error(`target ${index + 1} contains an invalid tag`);
        }
        if (candidate.tags.length > MAX_DOCKER_TAGS_PER_IMAGE) {
            throw new Error(`target ${index + 1} exceeds the ${MAX_DOCKER_TAGS_PER_IMAGE} tag limit`);
        }
        if (!candidate.useManifest && typeof candidate.repository !== 'string') {
            throw new Error(`target ${index + 1} requires a repository`);
        }
        return {
            useManifest: candidate.useManifest,
            repository: typeof candidate.repository === 'string' ? candidate.repository : undefined,
            tags: candidate.tags,
        };
    });
}

export function resolveDockerUploadTarget(
    target: DockerUploadTarget,
    manifest?: LoadManifestEntry | null,
): ResolvedDockerUploadTarget {
    if (target.useManifest) {
        if (!manifest) throw new Error('manifest.json not found');
        const picked = repoTagFromRepoTags(manifest.RepoTags);
        if (!picked.repository || !picked.tag) throw new Error('RepoTags invalid in manifest.json');
        return {
            repository: assertDockerRepository(picked.repository),
            tags: uniqueTags([picked.tag, ...target.tags]),
        };
    }

    const repository = assertDockerRepository(target.repository);
    const tags = uniqueTags(target.tags);
    if (tags.length === 0) throw new Error('at least one tag is required');
    return { repository, tags };
}
