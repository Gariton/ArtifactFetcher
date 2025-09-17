import fs from 'node:fs';
import { jobStore } from "@/lib/jobStore";
import { deleteS3Object } from "@/lib/storage/s3";
import { NextRequest, NextResponse } from "next/server";
import { logRequest } from "@/lib/requestLog";

export const POST = async (req: NextRequest) => {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId') || '';

    const job = jobStore.get(jobId);
    logRequest(req, `delete job=${jobId}`);
    if (!job) return new Response('Not Found', { status: 404 });
    if (job.objectKey) {
        try {
            await deleteS3Object(job.objectKey);
        } catch (err) {
            console.error('Failed to delete S3 object', err);
            return new Response('Failed', { status: 500 });
        }
    } else if (job.tarPath) {
        try { fs.rmSync(job.tarPath, { force: true }); }
        catch (err) {
            console.error('Failed to delete local file', err);
            return new Response('Failed', { status: 500 });
        }
    } else {
        return new Response('Not Ready', { status: 425 });
    }
    jobStore.delete(jobId);

    return NextResponse.json({status: "ok"}, {status: 200});
}
