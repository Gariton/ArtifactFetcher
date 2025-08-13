import { NextRequest } from 'next/server';
import fs from 'node:fs';
import { jobStore } from '@/lib/jobStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId') || '';
    const job = jobStore.get(jobId);
    if (!job) return new Response('Not Found', { status: 404 });
    if (job.status !== 'done' || !job.tarPath || !job.filename) return new Response('Not Ready', { status: 425 });
    
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

    file.on('close', () => { try { fs.rmSync(job.tarPath!, { force: true }); } catch {} });

    return new Response(web as unknown as BodyInit, {
        headers: {
            'Content-Type': 'application/x-tar',
            'Content-Disposition': `attachment; filename="${job.filename}"`,
            'Cache-Control': 'no-store',
        },
    });
}