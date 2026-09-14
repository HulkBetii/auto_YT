import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { channelConfig } from "@/lib/db/schema";

export const WORKER_HEARTBEAT_STALE_MS = 2 * 60 * 1000;

export async function getWorkerHeartbeatSnapshot() {
  const [row] = await db
    .select({
      workerLastSeenAt: channelConfig.workerLastSeenAt,
      workerLastStatus: channelConfig.workerLastStatus,
    })
    .from(channelConfig)
    .where(eq(channelConfig.key, "worker_heartbeat"))
    .limit(1);

  const lastSeenAt = row?.workerLastSeenAt ?? null;
  const ageMs = lastSeenAt ? Date.now() - lastSeenAt.getTime() : null;
  const healthy =
    row?.workerLastStatus === "running" &&
    ageMs !== null &&
    ageMs >= 0 &&
    ageMs <= WORKER_HEARTBEAT_STALE_MS;

  return {
    healthy,
    status: row?.workerLastStatus ?? null,
    lastSeenAt: lastSeenAt?.toISOString() ?? null,
    ageSeconds: ageMs === null ? null : Math.max(0, Math.round(ageMs / 1000)),
  };
}
