import { NextResponse } from "next/server";

import { maybeStartNewBatch } from "@/lib/pipeline/batch";
import { runChainCycle } from "@/lib/pipeline/chain";
import { runTTSForReadyVideos } from "@/lib/pipeline/tts";

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
 * having to curl the cron endpoint with the bearer secret.
 *
 * Two things happen, mirroring the two cron jobs that would otherwise drive
 * the system end-to-end:
 *  1. `runChainCycle` — chain forward any `done` jobs (same as process-jobs,
 *     which polls every minute when registered).
 *  2. `maybeStartNewBatch` — if nothing is in flight, also kick off a fresh P1
 *     batch (same guarded logic as generate-topics, which on this project only
 *     runs WEEKLY — "0 0 * * 1" — so on-demand triggering here is the
 *     difference between waiting up to 7 days and getting a new batch of
 *     videos started right now). This is what makes the button a genuine
 *     "run the worker again, make more videos" control, not just an unstall
 *     button for the current batch.
 *
 * Both delegate to the exact same shared implementations their respective
 * cron routes use — single source of truth, see chain.ts / batch.ts.
 */
export async function POST() {
  const { processed, results, failedNotified } = await runChainCycle();
  const newBatch = await maybeStartNewBatch();
  const tts = await runTTSForReadyVideos();

  return NextResponse.json({ ok: true, processed, results, failedNotified, newBatch, tts });
}
