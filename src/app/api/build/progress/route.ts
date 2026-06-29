import { NextRequest } from 'next/server';
import { ProgressBus, globalBusMap } from '@/lib/progressBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (req: NextRequest) => {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId') || '';
    if (!jobId) return new Response('Bad Request', { status: 400 });

    // アップロード系のジョブはクライアントが先に SSE へ接続し、その後に
    // upload-multi などの POST がバスを生成する。接続が先行してもよいよう、
    // バスが未生成ならここで作成しておく（POST 側は get() で同じバスを再利用する）。
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
            'X-Accel-Buffering': 'no',
            'Content-Encoding': 'identity'
        },
    });
}