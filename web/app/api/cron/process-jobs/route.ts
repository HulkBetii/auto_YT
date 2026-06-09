import { NextResponse } from "next/server";

import { runChainCycle } from "@/lib/pipeline/chain";
import { runTTSForReadyVideos } from "@/lib/pipeline/tts";

export const maxDuration = 300;

/**
 * Polled by Vercel Cron (see vercel.json) — there is no long-lived orchestrator
 * process. Each run picks up jobs the worker finished since the last pass and
 * chains the pipeline forward (see lib/pipeline/chain.ts for the state machine
 * and `runChainCycle` for the actual cycle logic, shared with the dashboard's
 * manual "Chạy pipeline ngay" button at /api/jobs/process-now).
 */
export async function GET(request: Request) {
  const expected = process.env.DASHBOARD_SECRET;
  if (expected) {
    const provided = request.headers.get("authorization");
    if (provided !== `Bearer ${expected}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const { processed, results, failedNotified } = await runChainCycle();
  const tts = await runTTSForReadyVideos();

  return NextResponse.json({ ok: true, processed, results, failedNotified, tts });
}
