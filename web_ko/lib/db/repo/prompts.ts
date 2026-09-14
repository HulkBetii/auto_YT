import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { getKoConfigValue, KO_CONFIG_KEYS, setKoConfigValue } from "@/lib/db/repo/config";
import { koChannelConfig, koPromptVersions } from "@/lib/db/schema";
import {
  DEFAULT_FIDELITY_REVIEW_PROMPT,
  DEFAULT_OUTLINE_PROMPT,
  DEFAULT_SECTION_PROMPT,
  DEFAULT_SOURCE_AUDIT_PROMPT,
  PROMPT_REQUIREMENTS,
} from "@/lib/pipeline/default-prompts";

export const KO_PROMPT_KEYS = ["source_audit", "outline", "section", "fidelity_review"] as const;
export type KoPromptKey = (typeof KO_PROMPT_KEYS)[number];

const DEFAULT_PROMPTS: Record<KoPromptKey, string> = {
  source_audit: DEFAULT_SOURCE_AUDIT_PROMPT,
  outline: DEFAULT_OUTLINE_PROMPT,
  section: DEFAULT_SECTION_PROMPT,
  fidelity_review: DEFAULT_FIDELITY_REVIEW_PROMPT,
};

const ACTIVE_PROMPT_CONFIG_KEYS: Record<KoPromptKey, string> = {
  source_audit: KO_CONFIG_KEYS.activeSourceAuditPromptVersionId,
  outline: KO_CONFIG_KEYS.activeOutlinePromptVersionId,
  section: KO_CONFIG_KEYS.activeSectionPromptVersionId,
  fidelity_review: KO_CONFIG_KEYS.activeFidelityPromptVersionId,
};

export function validatePromptTemplate(promptKey: KoPromptKey, template: string): string[] {
  return PROMPT_REQUIREMENTS[promptKey].filter((placeholder) => !template.includes(placeholder));
}

export async function ensureDefaultPrompts(): Promise<void> {
  for (const promptKey of KO_PROMPT_KEYS) {
    const active = await getActivePrompt(promptKey);
    if (active) {
      if (
        active.createdBy === "seed" &&
        active.template.trim() !== DEFAULT_PROMPTS[promptKey].trim()
      ) {
        await insertPromptVersion({
          promptKey,
          template: DEFAULT_PROMPTS[promptKey],
          changeReason: "Sync manual Korean Playwright workflow",
          createdBy: "seed",
        });
      }
      continue;
    }
    try {
      const [created] = await db
        .insert(koPromptVersions)
        .values({
          promptKey,
          version: 1,
          template: DEFAULT_PROMPTS[promptKey],
          isActive: true,
          createdBy: "seed",
          changeReason: "Initial Korean channel prompt",
        })
        .returning();
      await setKoConfigValue(ACTIVE_PROMPT_CONFIG_KEYS[promptKey], String(created.id));
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "23505")) {
        throw error;
      }
    }
  }
}

export async function getActivePrompt(promptKey: KoPromptKey) {
  const configuredId = Number(await getKoConfigValue(ACTIVE_PROMPT_CONFIG_KEYS[promptKey]));
  if (Number.isInteger(configuredId) && configuredId > 0) {
    const [configured] = await db
      .select()
      .from(koPromptVersions)
      .where(and(eq(koPromptVersions.id, configuredId), eq(koPromptVersions.promptKey, promptKey)))
      .limit(1);
    if (configured) return configured;
  }

  const [row] = await db
    .select()
    .from(koPromptVersions)
    .where(and(eq(koPromptVersions.promptKey, promptKey), eq(koPromptVersions.isActive, true)))
    .limit(1);
  if (row) await setKoConfigValue(ACTIVE_PROMPT_CONFIG_KEYS[promptKey], String(row.id));
  return row ?? null;
}

export async function getPromptVersionById(id: number) {
  const [row] = await db.select().from(koPromptVersions).where(eq(koPromptVersions.id, id)).limit(1);
  return row ?? null;
}

export async function listPromptVersions(promptKey?: KoPromptKey) {
  const query = db.select().from(koPromptVersions);
  return promptKey
    ? query.where(eq(koPromptVersions.promptKey, promptKey)).orderBy(desc(koPromptVersions.createdAt))
    : query.orderBy(desc(koPromptVersions.createdAt));
}

export async function insertPromptVersion(input: {
  promptKey: KoPromptKey;
  template: string;
  changeReason?: string;
  createdBy?: "dashboard" | "seed";
}) {
  const missing = validatePromptTemplate(input.promptKey, input.template);
  if (missing.length > 0) {
    throw new Error(`Missing required placeholders: ${missing.join(", ")}`);
  }

  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ version: koPromptVersions.version })
      .from(koPromptVersions)
      .where(eq(koPromptVersions.promptKey, input.promptKey))
      .orderBy(desc(koPromptVersions.version))
      .limit(1);

    await tx
      .update(koPromptVersions)
      .set({ isActive: false })
      .where(and(eq(koPromptVersions.promptKey, input.promptKey), eq(koPromptVersions.isActive, true)));

    const [created] = await tx
      .insert(koPromptVersions)
      .values({
        promptKey: input.promptKey,
        version: (latest?.version ?? 0) + 1,
        template: input.template.trim(),
        isActive: true,
        createdBy: input.createdBy ?? "dashboard",
        changeReason: input.changeReason?.trim() || null,
      })
      .returning();
    await tx
      .insert(koChannelConfig)
      .values({
        key: ACTIVE_PROMPT_CONFIG_KEYS[input.promptKey],
        value: String(created.id),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: koChannelConfig.key,
        set: { value: String(created.id), updatedAt: new Date() },
      });
    return created;
  });
}
