import { NextResponse } from "next/server";

import { refreshAnalyticsAndTriggerP5, triggerP6IfBatchReady } from "@/lib/pipeline/analyticsCheck";

export const maxDuration = 300;

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
 * Polled by cron-job.org every hour (GET, Authorization: Bearer <DASHBOARD_SECRET>).
 * Refreshes YouTube view/like/comment counts for published videos (every 24h),
 * triggers P5 once a video has enough views + manually-entered CTR/AVD,
 * and triggers P6 when a batch of analyzed videos has accumulated.
 */
export async function GET(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  const p5Triggered = await refreshAnalyticsAndTriggerP5();
  const p6Batch = await triggerP6IfBatchReady();

  return NextResponse.json({ ok: true, p5Triggered, p6BatchTriggered: p6Batch });
}
