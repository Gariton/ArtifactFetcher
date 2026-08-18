'use server'

export async function getEnvironmentVar() {
    return {
        DOCKER_UPLOAD: process.env.DOCKER_UPLOAD ?? "false",
        DOCKER_UPLOAD_REGISTRY: process.env.DOCKER_UPLOAD_REGISTRY ?? "",
        DOCKER_UPLOAD_AUTH_CONFIGURED: process.env.DOCKER_UPLOAD_USERNAME || process.env.DOCKER_UPLOAD_PASSWORD ? "yes" : "no",

        NPM_UPLOAD: process.env.NPM_UPLOAD ?? "false",
        NPM_UPLOAD_REGISTRY: process.env.NPM_UPLOAD_REGISTRY ?? "",
        NPM_UPLOAD_AUTH_CONFIGURED: process.env.NPM_UPLOAD_AUTH_TOKEN || process.env.NPM_UPLOAD_USERNAME || process.env.NPM_UPLOAD_PASSWORD ? "yes" : "no",

        PIP_UPLOAD: process.env.PIP_UPLOAD ?? "false",
        PIP_UPLOAD_REGISTRY: process.env.PIP_UPLOAD_REGISTRY ?? "",
        PIP_UPLOAD_AUTH_CONFIGURED: process.env.PIP_UPLOAD_TOKEN || process.env.PIP_UPLOAD_USERNAME || process.env.PIP_UPLOAD_PASSWORD ? "yes" : "no",
        PIP_UPLOAD_SKIP_EXISTING: process.env.PIP_UPLOAD_SKIP_EXISTING ?? "false",

        RPM_UPLOAD: process.env.RPM_UPLOAD ?? "false",
        RPM_UPLOAD_REPOSITORY_URL: process.env.RPM_UPLOAD_REPOSITORY_URL ?? "",
        RPM_UPLOAD_AUTH_CONFIGURED: process.env.RPM_UPLOAD_TOKEN || process.env.RPM_UPLOAD_USERNAME || process.env.RPM_UPLOAD_PASSWORD ? "yes" : "no",
        RPM_UPLOAD_METHOD: process.env.RPM_UPLOAD_METHOD ?? "put",
        RPM_UPLOAD_IGNORE_TLS_VERIFY: process.env.RPM_UPLOAD_IGNORE_TLS_VERIFY ?? "false",

        GITLAB_BASE_URL: process.env.GITLAB_BASE_URL ?? "",
        GITLAB_TOKEN_CONFIGURED: process.env.GITLAB_TOKEN ? "yes" : "no",
    }
}
