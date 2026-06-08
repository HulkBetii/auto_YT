import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getConfigValue, setConfigValue } from "@/lib/db/repo/channel-config";
import { channelConfig } from "@/lib/db/schema";
import { logEvent } from "@/lib/observability/log";
import { notify } from "@/lib/notifications";

export const maxDuration = 60;

const STALL_THRESHOLD_MINUTES = 30;

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
 * The worker runs on the user's personal Mac, started manually — gaps in
 * `worker_last_seen_at` are EXPECTED (machine asleep/off overnight). So we
 * must NOT alert on "no heartbeat right now"; only on a heartbeat that
 * *stops mid-stream*: status='running' (the worker hasn't shut down
 * gracefully) AND the last beat is older than the stall threshold. A
 * graceful Ctrl+C writes status='stopped', which produces no alert.
 *
 * `worker_stall_alerted` guards against re-notifying every 10-minute tick
 * for the same stall episode; it's cleared once the heartbeat looks healthy
 * again (worker restarted, or someone fixed it and it caught up).
 */
async function evaluateWorkerStall() {
  const [row] = await db.select().from(channelConfig).where(eq(channelConfig.key, "worker_heartbeat")).limit(1);

  if (!row?.workerLastSeenAt || row.workerLastStatus !== "running") {
    if ((await getConfigValue("worker_stall_alerted")) === "true") {
      await setConfigValue("worker_stall_alerted", "false");
    }
    return { stalled: false, reason: "worker not currently marked running" };
  }

  const minutesSinceLastBeat = (Date.now() - row.workerLastSeenAt.getTime()) / (1000 * 60);
  if (minutesSinceLastBeat <= STALL_THRESHOLD_MINUTES) {
    if ((await getConfigValue("worker_stall_alerted")) === "true") {
      await setConfigValue("worker_stall_alerted", "false");
    }
    return { stalled: false, minutesSinceLastBeat };
  }

  const alreadyAlerted = (await getConfigValue("worker_stall_alerted")) === "true";
  if (!alreadyAlerted) {
    await notify(
      `🛑 Worker có vẻ đã <b>bị treo</b> — trạng thái vẫn là "running" nhưng không có heartbeat trong ${minutesSinceLastBeat.toFixed(0)} phút (ngưỡng ${STALL_THRESHOLD_MINUTES} phút). Có khả năng đã crash giữa chừng — kiểm tra lại Mac.`,
    );
    await setConfigValue("worker_stall_alerted", "true");
    logEvent("worker_stall_detected", { minutesSinceLastBeat });
  }

  return { stalled: true, minutesSinceLastBeat, alreadyAlerted };
}

export async function GET(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  const result = await evaluateWorkerStall();
  return NextResponse.json({ ok: true, ...result });
}
