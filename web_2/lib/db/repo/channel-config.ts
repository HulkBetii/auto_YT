import { eq } from "drizzle-orm";

import { db } from "../index";
import { ahChannelConfig } from "../schema";

export async function getAhConfigValue(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: ahChannelConfig.value })
    .from(ahChannelConfig)
    .where(eq(ahChannelConfig.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setAhConfigValue(key: string, value: string): Promise<void> {
  await db
    .insert(ahChannelConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: ahChannelConfig.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getAllAhConfig(): Promise<Record<string, string>> {
  const rows = await db.select().from(ahChannelConfig);
  return Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""]));
}
