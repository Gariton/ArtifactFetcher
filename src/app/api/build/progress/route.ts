import { NextRequest } from 'next/server';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';
import { jobStore } from '@/lib/jobStore';
import { isValidJobId } from '@/lib/inputSafety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const parsedSseLifetime = Number(process.env.SSE_MAX_CONNECTION_MS);
const SSE_MAX_CONNECTION_MS = Number.isSafeInteger(parsedSseLifetime) && parsedSseLifetime > 0
    ? parsedSseLifetime
    : 30 * 60 * 1000;

export const GET = async (req: NextRequest) => {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId') || '';
    if (!isValidJobId(jobId)) return new Response('Bad Request', { status: 400 });

    // アップロード系のジョブはクライアントが先に SSE へ接続し、その後に
    // POST するため、正しい nanoid のみ短寿命の queued ジョブとして予約する。
    // JobStore の上限と queued TTL により任意 jobId で Bus が無制限に増えない。
    const job = jobStore.get(jobId) ?? jobStore.reserve(jobId);
    if (!job) return new Response('Too Many Jobs', { status: 503 });

    let bus = globalBusMap.get(jobId);
    if (!bus) {
        bus = new ProgressBus();
        globalBusMap.set(jobId, bus);
    }
    
    const stream = new ReadableStream({
        start(controller) {
            const enc = new TextEncoder();
            const push = (s: string) => controller.enqueue(enc.encode(s));

            push(': connected\n\n');

            const buffered = bus.getRecentEvents?.() || [];
            for (const event of buffered) {
                push(`data: ${JSON.stringify(event)}\n\n`);
            }

            const handler = (e: any) => {
                push(`data: ${JSON.stringify(e)}\n\n`);
            }
            bus.on('progress', handler);

            const hb = setInterval(() => push(': ping\n\n'), 15000);
            let closed = false;
            const abort = () => {
                if (closed) return;
                closed = true;
                clearInterval(hb);
                clearTimeout(maxLifetime);
                bus.removeListener('progress', handler);
                bus.removeListener('close', abort);
                try { controller.close(); } catch {}
            }
            const maxLifetime = setTimeout(abort, SSE_MAX_CONNECTION_MS);
            bus.on('close', abort);
            req.signal.addEventListener('abort', abort, { once: true });
            if (req.signal.aborted) abort();
        },
    });
        
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            'Content-Encoding': 'identity'
        },
    });
}
