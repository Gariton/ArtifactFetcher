type Environment = Record<string, string | undefined>;

export type DockerPublicRuntimeConfig = {
    DOCKER_UPLOAD: string;
    DOCKER_UPLOAD_REGISTRY: string;
};

export type NpmPublicRuntimeConfig = {
    NPM_UPLOAD: string;
    NPM_UPLOAD_REGISTRY: string;
};

export type PipPublicRuntimeConfig = {
    PIP_UPLOAD: string;
    PIP_UPLOAD_REGISTRY: string;
    PIP_UPLOAD_SKIP_EXISTING: string;
};

export type RpmPublicRuntimeConfig = {
    RPM_UPLOAD: string;
    RPM_UPLOAD_REPOSITORY_URL: string;
    RPM_UPLOAD_METHOD: string;
    RPM_UPLOAD_IGNORE_TLS_VERIFY: string;
};

export function readDockerPublicRuntimeConfig(
    env: Environment = process.env,
): DockerPublicRuntimeConfig {
    return {
        DOCKER_UPLOAD: env.DOCKER_UPLOAD ?? 'false',
        DOCKER_UPLOAD_REGISTRY: env.DOCKER_UPLOAD_REGISTRY ?? '',
    };
}

export function readNpmPublicRuntimeConfig(
    env: Environment = process.env,
): NpmPublicRuntimeConfig {
    return {
        NPM_UPLOAD: env.NPM_UPLOAD ?? 'false',
        NPM_UPLOAD_REGISTRY: env.NPM_UPLOAD_REGISTRY ?? '',
    };
}

export function readPipPublicRuntimeConfig(
    env: Environment = process.env,
): PipPublicRuntimeConfig {
    return {
        PIP_UPLOAD: env.PIP_UPLOAD ?? 'false',
        PIP_UPLOAD_REGISTRY: env.PIP_UPLOAD_REGISTRY ?? '',
        PIP_UPLOAD_SKIP_EXISTING: env.PIP_UPLOAD_SKIP_EXISTING ?? 'false',
    };
}

export function readRpmPublicRuntimeConfig(
    env: Environment = process.env,
): RpmPublicRuntimeConfig {
    return {
        RPM_UPLOAD: env.RPM_UPLOAD ?? 'false',
        RPM_UPLOAD_REPOSITORY_URL: env.RPM_UPLOAD_REPOSITORY_URL ?? '',
        RPM_UPLOAD_METHOD: env.RPM_UPLOAD_METHOD ?? 'put',
        RPM_UPLOAD_IGNORE_TLS_VERIFY: env.RPM_UPLOAD_IGNORE_TLS_VERIFY ?? 'false',
    };
}
