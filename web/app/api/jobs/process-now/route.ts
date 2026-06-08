import { NextResponse } from "next/server";

import { runChainCycle } from "@/lib/pipeline/chain";

export const maxDuration = 300;

/**
 * Manual "Chạy pipeline ngay" trigger for the dashboard (see RunPipelineButton
 * on the overview page). Gated by the same cookie-based dashboard auth as the
 * rest of `/api/**` (proxy.ts) — no separate Bearer check needed here, unlike
 * the cron route, since the browser carries the `dashboard_auth` cookie.
 *
 * Why this exists: `/api/cron/process-jobs` is meant to be polled every minute
 * by Vercel Cron per the README, but as of 2026-06-08 it is NOT actually
 * registered in vercel.json (only evaluate-rollback and generate-topics are —
 * likely the Hobby plan's 2-cron-job cap). Without an external scheduler,
 * completed jobs pile up with `consumed_at = NULL` and the pipeline visibly
 * stalls after each stage ("dừng ở 5 topic"). This button lets the operator
 * manually advance the pipeline by one tick from the dashboard instead of
 * having to curl the cron endpoint with the bearer secret. It calls the exact
 * same `runChainCycle` the cron route does — single source of truth, see
 * chain.ts's docstring on that function for the full story and the proper
 * long-term fix (external scheduler / Claude scheduled-tasks).
 */
export async function POST() {
  const { processed, results, failedNotified } = await runChainCycle();
  return NextResponse.json({ ok: true, processed, results, failedNotified });
}
