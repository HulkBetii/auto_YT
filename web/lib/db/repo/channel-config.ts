import { eq } from "drizzle-orm";

import { db } from "../index";
import { channelConfig } from "../schema";

export async function getConfigValue(key: string) {
  const [row] = await db
    .select({ value: channelConfig.value })
    .from(channelConfig)
    .where(eq(channelConfig.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setConfigValue(key: string, value: string) {
  await db
    .insert(channelConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: channelConfig.key, set: { value, updatedAt: new Date() } });
}

/** Recorded by the worker on every poll cycle — drives the "stopped mid-run" alert. */
export async function recordWorkerHeartbeat(status: "running" | "stopped") {
  await db
    .insert(channelConfig)
    .values({
      key: "worker_heartbeat",
      workerLastSeenAt: new Date(),
      workerLastStatus: status,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: channelConfig.key,
      set: { workerLastSeenAt: new Date(), workerLastStatus: status, updatedAt: new Date() },
    });
}
