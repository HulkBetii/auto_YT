import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { koJpChannelConfig } from "@/lib/db/schema";

export const KO_JP_CONFIG_KEYS = {
  activeSourceAuditPromptVersionId: "active_source_audit_prompt_version_id",
  activeOutlinePromptVersionId: "active_outline_prompt_version_id",
  activeScriptPromptVersionId: "active_script_prompt_version_id",
  activeReviewPromptVersionId: "active_review_prompt_version_id",
  workerLastSeen: "worker_last_seen",
  workerState: "worker_state",
  workerError: "worker_error",
  profileLocked: "profile_locked",
  chainLastRunAt: "chain_last_run_at",
} as const;

export async function getKoJpConfigValue(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: koJpChannelConfig.value })
    .from(koJpChannelConfig)
    .where(eq(koJpChannelConfig.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function getAllKoJpConfig(): Promise<Record<string, string>> {
  const rows = await db.select().from(koJpChannelConfig);
  return Object.fromEntries(rows.map((row) => [row.key, row.value ?? ""]));
}

export async function setKoJpConfigValue(key: string, value: string): Promise<void> {
  await db
    .insert(koJpChannelConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: koJpChannelConfig.key,
      set: { value, updatedAt: new Date() },
    });
}
