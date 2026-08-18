type GitLabEnvironment = Record<string, string | undefined>;

export type GitLabRuntimeConfig = {
    baseUrl: string;
    token?: string;
};

export type GitLabPublicConfig = {
    baseUrl: string;
    tokenConfigured: boolean;
};

export function readGitLabRuntimeConfig(
    env: GitLabEnvironment = process.env,
): GitLabRuntimeConfig {
    const baseUrl = env.GITLAB_BASE_URL?.trim() || '';
    const token = env.GITLAB_TOKEN?.trim() || undefined;
    return { baseUrl, token };
}

export function readGitLabPublicConfig(
    env: GitLabEnvironment = process.env,
): GitLabPublicConfig {
    const { baseUrl, token } = readGitLabRuntimeConfig(env);
    return { baseUrl, tokenConfigured: Boolean(token) };
}
