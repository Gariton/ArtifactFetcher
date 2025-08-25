'use server'

export async function getEnvironmentVar() {
    return {
        DOCKER_UPLOAD: process.env.DOCKER_UPLOAD ?? "yes",
        DOCKER_UPLOAD_REGISTORY: process.env.DOCKER_UPLOAD_REGISTORY ?? "",
        DOCKER_UPLOAD_USERNAME: process.env.DOCKER_UPLOAD_USERNAME ?? "",
        DOCKER_UPLOAD_PASSWORD: process.env.DOCKER_UPLOAD_PASSWORD ?? ""
    }
}