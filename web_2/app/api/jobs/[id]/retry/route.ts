import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { retryAhJob } from "@/lib/db/repo/jobs";
import { updateAhVideoStatus } from "@/lib/db/repo/videos";
import type { AhVideoStatus } from "@/lib/db/schema";

const STAGE_TO_VIDEO_STATUS: Record<string, AhVideoStatus> = {
  S1: "s1_pending",
  S2: "s2_pending",
  S3: "s3_pending",
  S4: "s4_pending",
};

async function assertAuth() {
  const secret = process.env.DASHBOARD_SECRET;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  return !secret || auth === secret;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertAuth())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const jobId = parseInt(id, 10);
  if (isNaN(jobId)) return NextResponse.json({ ok: false, error: "Invalid job ID" }, { status: 400 });

  const updated = await retryAhJob(jobId);
  if (!updated) {
    return NextResponse.json({ ok: false, error: "Job not found or not failed" }, { status: 404 });
  }

  // Reset video status back to the appropriate pending status
  if (updated.videoId) {
    const videoStatus = STAGE_TO_VIDEO_STATUS[updated.stage];
    if (videoStatus) {
      await updateAhVideoStatus(updated.videoId, videoStatus);
    }
  }

  return NextResponse.json({ ok: true });
}
