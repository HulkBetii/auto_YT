import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { retryDrJob } from "@/lib/db/repo/jobs";
import { updateDrEpisodeStatus } from "@/lib/db/repo/episodes";
import type { DrEpisodeStatus } from "@/lib/db/schema";
import { STAGE_TO_EPISODE_STATUS } from "@/lib/pipeline/format";

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

  const updated = await retryDrJob(jobId);
  if (!updated) {
    return NextResponse.json({ ok: false, error: "Job not found or not failed" }, { status: 404 });
  }

  // Reset episode status back to the appropriate pending status for this stage.
  if (updated.episodeId) {
    const status = STAGE_TO_EPISODE_STATUS[updated.stage];
    if (status) {
      await updateDrEpisodeStatus(updated.episodeId, status as DrEpisodeStatus);
    }
  }

  return NextResponse.json({ ok: true });
}
