import path from 'node:path';

const SAFE_FILENAME_CHARS = /[^a-zA-Z0-9._@+-]+/g;
const DOCKER_TAG_PATTERN = /^[\w][\w.-]{0,127}$/;
const DOCKER_REPOSITORY_SEGMENT_PATTERN = /^[a-z0-9]+(?:(?:[._]|__|[-]+)[a-z0-9]+)*$/;
const HF_REPO_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;

/**
 * Convert a user-controlled label to one safe filename component.
 * This function deliberately never preserves directory separators.
 */
export function safeFilenamePart(input: unknown, fallback: string, maxLength = 128): string {
    const normalized = String(input ?? '')
        .normalize('NFKC')
        .replace(SAFE_FILENAME_CHARS, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[.-]+|[.-]+$/g, '')
        .slice(0, maxLength);
    return normalized || fallback;
}

export function safeBundleName(input: unknown, fallback: string): string {
    return safeFilenamePart(input, fallback, 128);
}

/** Resolve a remote relative path while proving it remains below root. */
export function resolveWithin(root: string, relativePath: string): string {
    if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
        throw new Error(`unsafe relative path: ${relativePath || '(empty)'}`);
    }

    // Remote manifests always use POSIX separators. Treat backslashes as separators too,
    // so an archive produced on Linux cannot become unsafe when moved to Windows.
    const portable = relativePath.replace(/\\/g, '/');
    const segments = portable.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new Error(`unsafe relative path: ${relativePath}`);
    }

    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, ...segments);
    if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(`path escapes working directory: ${relativePath}`);
    }
    return resolved;
}

export function assertDockerTag(tag: unknown): string {
    const value = String(tag ?? '').trim();
    if (!DOCKER_TAG_PATTERN.test(value)) {
        throw new Error('tag must be a valid Docker tag (1-128 characters)');
    }
    return value;
}

export function assertDockerRepository(repository: unknown): string {
    const value = String(repository ?? '').trim().replace(/^\/+|\/+$/g, '');
    if (!value || value.length > 255 || value.split('/').some((segment) => !DOCKER_REPOSITORY_SEGMENT_PATTERN.test(segment))) {
        throw new Error('repository must be a valid lowercase Docker repository name');
    }
    return value;
}

export function assertHfRepoId(repoId: unknown): string {
    const value = String(repoId ?? '').trim();
    const segments = value.split('/');
    if (segments.length < 1 || segments.length > 2 || segments.some((segment) => !HF_REPO_SEGMENT_PATTERN.test(segment))) {
        throw new Error('repoId must be a valid Hugging Face repository id');
    }
    return value;
}

export function safeHfRevisionDirectory(revision: unknown): string {
    return safeFilenamePart(revision, 'main', 128);
}

export function isValidJobId(jobId: unknown): jobId is string {
    return typeof jobId === 'string' && /^[A-Za-z0-9_-]{21}$/.test(jobId);
}
