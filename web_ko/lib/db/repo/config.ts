import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { koChannelConfig } from "@/lib/db/schema";

export const KO_CONFIG_KEYS = {
  activeSourceAuditPromptVersionId: "active_source_audit_prompt_version_id",
  activeOutlinePromptVersionId: "active_outline_prompt_version_id",
  activeSectionPromptVersionId: "active_section_prompt_version_id",
  activeFidelityPromptVersionId: "active_fidelity_prompt_version_id",
  workerLastSeen: "worker_last_seen",
  workerState: "worker_state",
  workerError: "worker_error",
  profileLocked: "profile_locked",
  chainLastRunAt: "chain_last_run_at",
} as const;

export async function getKoConfigValue(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: koChannelConfig.value })
    .from(koChannelConfig)
    .where(eq(koChannelConfig.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function getAllKoConfig(): Promise<Record<string, string>> {
  const rows = await db.select().from(koChannelConfig);
  return Object.fromEntries(rows.map((row) => [row.key, row.value ?? ""]));
}

export async function setKoConfigValue(key: string, value: string): Promise<void> {
  await db
    .insert(koChannelConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: koChannelConfig.key,
      set: { value, updatedAt: new Date() },
    });
}
