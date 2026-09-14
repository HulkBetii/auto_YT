import { NextResponse } from "next/server";

import { maybeStartNewBatch } from "@/lib/pipeline/batch";
import { getWorkerHeartbeatSnapshot } from "@/lib/pipeline/workerHeartbeat";

export async function POST() {
  const [batch, worker] = await Promise.all([
    maybeStartNewBatch(),
    getWorkerHeartbeatSnapshot(),
  ]);

  return NextResponse.json(
    { ok: batch.triggered, ...batch, worker },
    { status: batch.triggered ? 200 : 409 },
  );
}
