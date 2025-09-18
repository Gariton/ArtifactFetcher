'use server'

export async function getEnvironmentVar() {
    return {
        DOCKER_UPLOAD: process.env.DOCKER_UPLOAD ?? "yes",
        DOCKER_UPLOAD_REGISTORY: process.env.DOCKER_UPLOAD_REGISTORY ?? "",
        DOCKER_UPLOAD_USERNAME: process.env.DOCKER_UPLOAD_USERNAME ?? "",
        DOCKER_UPLOAD_PASSWORD: process.env.DOCKER_UPLOAD_PASSWORD ?? "",

        NPM_UPLOAD: process.env.NPM_UPLOAD ?? "yes",
        NPM_UPLOAD_REGISTORY: process.env.NPM_UPLOAD_REGISTORY ?? "",
        NPM_UPLOAD_AUTH_TOKEN: process.env.NPM_UPLOAD_AUTH_TOKEN ?? "",
        NPM_UPLOAD_USERNAME: process.env.NPM_UPLOAD_USERNAME ?? "",
        NPM_UPLOAD_PASSWORD: process.env.NPM_UPLOAD_PASSWORD ?? "",
    }
}