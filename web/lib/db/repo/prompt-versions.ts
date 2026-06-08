import { and, desc, eq } from "drizzle-orm";

import { db } from "../index";
import { promptVersions, type promptKeyEnum } from "../schema";

type PromptKey = (typeof promptKeyEnum.enumValues)[number];

export async function getActivePromptVersion(promptKey: PromptKey) {
  const [row] = await db
    .select()
    .from(promptVersions)
    .where(and(eq(promptVersions.promptKey, promptKey), eq(promptVersions.isActive, true)))
    .limit(1);
  return row ?? null;
}

export async function getLatestVersionNumber(promptKey: PromptKey) {
  const [row] = await db
    .select({ version: promptVersions.version })
    .from(promptVersions)
    .where(eq(promptVersions.promptKey, promptKey))
    .orderBy(desc(promptVersions.version))
    .limit(1);
  return row?.version ?? 0;
}

/**
 * Deactivates the current active version (if any) and inserts a new active one.
 * The neon-http driver has no transaction support, so these run as two plain
 * statements — the partial unique index `prompt_versions_one_active_per_key` is
 * the real guarantee against two concurrent callers both ending up active; if the
 * insert below ever raced and violated it, Postgres would reject it outright.
 */
export async function activateNewPromptVersion(input: {
  promptKey: PromptKey;
  template: string;
  createdBy: (typeof promptVersions.$inferInsert)["createdBy"];
  changeReason?: string;
  effectiveFromVideoId?: number;
}) {
  await db
    .update(promptVersions)
    .set({ isActive: false })
    .where(and(eq(promptVersions.promptKey, input.promptKey), eq(promptVersions.isActive, true)));

  const nextVersion = (await getLatestVersionNumber(input.promptKey)) + 1;

  const [created] = await db
    .insert(promptVersions)
    .values({
      promptKey: input.promptKey,
      version: nextVersion,
      template: input.template,
      isActive: true,
      createdBy: input.createdBy,
      changeReason: input.changeReason,
      effectiveFromVideoId: input.effectiveFromVideoId,
    })
    .returning();

  return created;
}
