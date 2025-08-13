import { NextRequest } from 'next/server';
import { globalBusMap } from '@/lib/progressBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (req: NextRequest) => {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId') || '';
    const bus = globalBusMap.get(jobId);
    if (!bus) return new Response('Not Found', { status: 404 });
    
    const stream = new ReadableStream({
        start(controller) {
            const enc = new TextEncoder();
            const push = (s: string) => controller.enqueue(enc.encode(s));

            push(': connected\n\n');

            const handler = (e: any) => {
                push(`data: ${JSON.stringify(e)}\n\n`);
            }
            bus.on('progress', handler);

            const hb = setInterval(() => push(': ping\n\n'), 15000);
            const abort = () => {
                clearInterval(hb);
                bus.removeListener('progress', handler);
                controller.close();
            }
            req.signal.addEventListener('abort', abort);
        },
    });
        
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        },
    });
}