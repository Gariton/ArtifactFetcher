'use server'

export async function getEnvironmentVar() {
    return {
        DOCKER_UPLOAD: process.env.DOCKER_UPLOAD ?? "yes",
        DOCKER_UPLOAD_REGISTRY: process.env.DOCKER_UPLOAD_REGISTRY ?? "",
        DOCKER_UPLOAD_USERNAME: process.env.DOCKER_UPLOAD_USERNAME ?? "",
        DOCKER_UPLOAD_PASSWORD: process.env.DOCKER_UPLOAD_PASSWORD ?? "",

        NPM_UPLOAD: process.env.NPM_UPLOAD ?? "yes",
        NPM_UPLOAD_REGISTRY: process.env.NPM_UPLOAD_REGISTRY ?? "",
        NPM_UPLOAD_AUTH_TOKEN: process.env.NPM_UPLOAD_AUTH_TOKEN ?? "",
        NPM_UPLOAD_USERNAME: process.env.NPM_UPLOAD_USERNAME ?? "",
        NPM_UPLOAD_PASSWORD: process.env.NPM_UPLOAD_PASSWORD ?? "",

        PIP_UPLOAD: process.env.PIP_UPLOAD ?? "yes",
        PIP_UPLOAD_REGISTRY: process.env.PIP_UPLOAD_REGISTRY ?? "",
        PIP_UPLOAD_USERNAME: process.env.PIP_UPLOAD_USERNAME ?? "",
        PIP_UPLOAD_PASSWORD: process.env.PIP_UPLOAD_PASSWORD ?? "",
        PIP_UPLOAD_TOKEN: process.env.PIP_UPLOAD_TOKEN ?? "",
        PIP_UPLOAD_SKIP_EXISTING: process.env.PIP_UPLOAD_SKIP_EXISTING ?? "false",
    }
}
