import { jobStore } from "@/lib/jobStore";
import { NextRequest, NextResponse } from "next/server";
import fs from 'node:fs';

export const POST = async (req: NextRequest) => {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId') || '';

    const job = jobStore.get(jobId);
    if (!job) return new Response('Not Found', { status: 404 });
    if (!job.tarPath || !job.filename) return new Response('Not Ready', { status: 425 });

    try { fs.rmSync(job.tarPath!, { force: true }); } catch {};
    jobStore.delete(jobId);

    return NextResponse.json({status: "ok"}, {status: 200});
}