import { NextResponse } from "next/server";

import { runChainCycle } from "@/lib/pipeline/chain";
import { refreshAnalyticsAndTriggerP5, triggerP6IfBatchReady } from "@/lib/pipeline/analyticsCheck";
import { runTTSForReadyVideos } from "@/lib/pipeline/tts";
import { getWorkerHeartbeatSnapshot } from "@/lib/pipeline/workerHeartbeat";

export const maxDuration = 300;

/** Advances existing work only. Creating a P1 batch has its own confirmed endpoint. */
export async function POST() {
  const { processed, results, failedNotified } = await runChainCycle();
  const tts = await runTTSForReadyVideos();
  const p5Triggered = await refreshAnalyticsAndTriggerP5();
  const p6Batch = await triggerP6IfBatchReady();
  const worker = await getWorkerHeartbeatSnapshot();

  return NextResponse.json({ ok: true, processed, results, failedNotified, tts, p5Triggered, p6Batch, worker });
}
