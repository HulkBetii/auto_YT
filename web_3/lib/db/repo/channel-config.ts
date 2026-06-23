import { eq } from "drizzle-orm";

import { db } from "../index";
import { drChannelConfig } from "../schema";

export async function getDrConfigValue(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: drChannelConfig.value })
    .from(drChannelConfig)
    .where(eq(drChannelConfig.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setDrConfigValue(key: string, value: string): Promise<void> {
  await db
    .insert(drChannelConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: drChannelConfig.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getAllDrConfig(): Promise<Record<string, string>> {
  const rows = await db.select().from(drChannelConfig);
  return Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""]));
}
