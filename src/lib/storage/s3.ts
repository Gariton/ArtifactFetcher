import fs from 'node:fs';
import { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommandInput, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export type S3Config = {
    bucket: string;
    region: string;
    endpoint?: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
};

let cachedConfig: S3Config | null = null;
let cachedClient: S3Client | null = null;

function resolveConfig(): S3Config {
    if (cachedConfig) return cachedConfig;
    const bucket = process.env.S3_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION || 'us-east-1';
    const forcePathStyleEnv = process.env.S3_FORCE_PATH_STYLE;

    if (!bucket) throw new Error('S3_BUCKET is not configured');
    if (!accessKeyId) throw new Error('S3_ACCESS_KEY_ID is not configured');
    if (!secretAccessKey) throw new Error('S3_SECRET_ACCESS_KEY is not configured');

    const forcePathStyle = forcePathStyleEnv ? forcePathStyleEnv.toLowerCase() === 'true' : true;

    cachedConfig = {
        bucket,
        region,
        endpoint,
        forcePathStyle,
        accessKeyId,
        secretAccessKey,
    };
    return cachedConfig;
}

function getClient(): S3Client {
    if (cachedClient) return cachedClient;
    const cfg = resolveConfig();
    cachedClient = new S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint,
        forcePathStyle: cfg.forcePathStyle,
        credentials: {
            accessKeyId: cfg.accessKeyId,
            secretAccessKey: cfg.secretAccessKey,
        },
    });
    return cachedClient;
}

export async function uploadFileToS3({ filePath, key, contentType }: { filePath: string; key: string; contentType?: string; }) {
    const client = getClient();
    const cfg = resolveConfig();
    const body = fs.createReadStream(filePath);
    const params: PutObjectCommandInput = {
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
    };
    const uploader = new Upload({ client, params });
    await uploader.done();
}

export async function uploadStreamToS3({ stream, key, contentType }: { stream: Readable; key: string; contentType?: string; }) {
    const client = getClient();
    const cfg = resolveConfig();
    const uploader = new Upload({
        client,
        params: {
            Bucket: cfg.bucket,
            Key: key,
            Body: stream,
            ContentType: contentType,
        },
    });
    await uploader.done();
}

export async function streamS3Object(key: string) {
    const client = getClient();
    const cfg = resolveConfig();
    const result = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    if (!result.Body) throw new Error('Object body is empty');
    if (typeof (result.Body as any).transformToWebStream === 'function') {
        return { stream: await (result.Body as any).transformToWebStream(), contentLength: result.ContentLength, contentType: result.ContentType };
    }
    const body = result.Body as Readable;
    return { stream: Readable.toWeb(body), contentLength: result.ContentLength, contentType: result.ContentType };
}

export async function deleteS3Object(key: string) {
    const client = getClient();
    const cfg = resolveConfig();
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
}

export function isS3Configured(): boolean {
    return Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
}

function artifactPrefix(): string {
    const configured = (process.env.S3_OBJECT_PREFIX || 'artifact-fetcher/').trim().replace(/^\/+/, '');
    const safe = configured.replace(/[^A-Za-z0-9._/-]/g, '-').replace(/\/{2,}/g, '/');
    const resolved = safe || 'artifact-fetcher';
    return resolved.endsWith('/') ? resolved : `${resolved}/`;
}

export function makeArtifactObjectKey(jobId: string, filename: string): string {
    const safeFilename = filename.replace(/[\\/\0]/g, '_');
    return `${artifactPrefix()}${jobId}/${safeFilename}`;
}

/** Remove expired objects independently of the in-memory JobStore. */
export async function cleanupExpiredS3Artifacts(maxAgeMs: number): Promise<number> {
    const client = getClient();
    const cfg = resolveConfig();
    const cutoff = Date.now() - maxAgeMs;
    let continuationToken: string | undefined;
    let deleted = 0;
    do {
        const page = await client.send(new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: artifactPrefix(),
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
        }));
        for (const object of page.Contents || []) {
            if (!object.Key || !object.LastModified || object.LastModified.getTime() > cutoff) continue;
            await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: object.Key }));
            deleted += 1;
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return deleted;
}

export function getS3BucketName() {
    return resolveConfig().bucket;
}

export function getS3ClientConfig() {
    return resolveConfig();
}
