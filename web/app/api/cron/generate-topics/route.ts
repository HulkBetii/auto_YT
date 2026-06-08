import { NextResponse } from "next/server";

import { maybeStartNewBatch } from "@/lib/pipeline/batch";

export const maxDuration = 60;

function requireAuth(request: Request): NextResponse | null {
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected) return null;
  const provided = request.headers.get("authorization");
  if (provided !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Polled weekly by Vercel Cron (see vercel.json — "0 0 * * 1"). Starts a new
 * P1 batch if (and only if) nothing is currently in flight — see
 * lib/pipeline/batch.ts `maybeStartNewBatch` for the actual guard + insert
 * logic, now shared with the dashboard's manual "Chạy pipeline ngay" button
 * (RunPipelineButton -> /api/jobs/process-now), which also tries to start a
 * fresh batch on demand so the operator doesn't have to wait up to a week.
 */
export async function GET(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  const result = await maybeStartNewBatch();
  return NextResponse.json({ ok: true, ...result });
}
