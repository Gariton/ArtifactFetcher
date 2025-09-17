import { NextRequest } from 'next/server';
import fs from 'node:fs';
import { jobStore } from '@/lib/jobStore';
import { streamS3Object } from '@/lib/storage/s3';
import { logRequest } from '@/lib/requestLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId') || '';
    const job = jobStore.get(jobId);
    logRequest(req, `download job=${jobId}`);
    console.log(job)
    if (!job) return new Response('Not Found', { status: 404 });
    if (!job.filename) return new Response('Not Ready', { status: 425 });

    if (job.objectKey) {
        const { stream, contentLength, contentType } = await streamS3Object(job.objectKey);

        return new Response(stream as unknown as BodyInit, {
            headers: {
                'Content-Type': contentType || 'application/x-tar',
                'Content-Disposition': `attachment; filename="${job.filename}"`,
                'Cache-Control': 'no-store',
                ...(contentLength ? { 'Content-Length': String(contentLength) } : {}),
            },
        });
    }

    if (job.tarPath) {
        const file = fs.createReadStream(job.tarPath);
        const web = new ReadableStream<Uint8Array>({
            start(controller) {
                file.on('data', (chunk: Buffer | string) => {
                    if (typeof chunk === 'string') {
                        chunk = Buffer.from(chunk);
                    }
                    controller.enqueue(new Uint8Array(chunk));
                });
                file.on('end', () => controller.close());
                file.on('error', (err) => controller.error(err));
            },
            cancel() {
                try { file.destroy(); } catch {}
            }
        });

        return new Response(web as unknown as BodyInit, {
            headers: {
                'Content-Type': 'application/x-tar',
                'Content-Disposition': `attachment; filename="${job.filename}"`,
                'Cache-Control': 'no-store',
            },
        });
    }

    return new Response('Not Ready', { status: 425 });
}
