import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "../index";
import { ahPromptVersions } from "../schema";

export const DEFAULT_PROMPT_SET_VERSION = "current";
export const AH_PROMPT_KEYS = ["S1", "S2", "S3", "S4"] as const;
export type AhPromptKey = (typeof AH_PROMPT_KEYS)[number];

export function normalizePromptSetVersion(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized || DEFAULT_PROMPT_SET_VERSION;
}

export async function getActiveAhPromptVersion(
  promptKey: string,
  promptSetVersion = DEFAULT_PROMPT_SET_VERSION,
) {
  const [row] = await db
    .select()
    .from(ahPromptVersions)
    .where(
      and(
        eq(ahPromptVersions.promptKey, promptKey),
        eq(ahPromptVersions.promptSetVersion, normalizePromptSetVersion(promptSetVersion)),
        eq(ahPromptVersions.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getLatestAhVersionNumber(
  promptKey: string,
  promptSetVersion = DEFAULT_PROMPT_SET_VERSION,
): Promise<number> {
  const [row] = await db
    .select({ version: ahPromptVersions.version })
    .from(ahPromptVersions)
    .where(
      and(
        eq(ahPromptVersions.promptKey, promptKey),
        eq(ahPromptVersions.promptSetVersion, normalizePromptSetVersion(promptSetVersion)),
      ),
    )
    .orderBy(desc(ahPromptVersions.version))
    .limit(1);
  return row?.version ?? 0;
}

export async function listAvailableAhPromptSets(): Promise<string[]> {
  const rows = await db
    .select({
      promptKey: ahPromptVersions.promptKey,
      promptSetVersion: ahPromptVersions.promptSetVersion,
    })
    .from(ahPromptVersions)
    .where(
      and(
        eq(ahPromptVersions.isActive, true),
        inArray(ahPromptVersions.promptKey, [...AH_PROMPT_KEYS]),
      ),
    );

  const keysBySet = new Map<string, Set<string>>();
  for (const row of rows) {
    const setVersion = normalizePromptSetVersion(row.promptSetVersion);
    const keys = keysBySet.get(setVersion) ?? new Set<string>();
    keys.add(row.promptKey);
    keysBySet.set(setVersion, keys);
  }

  const completeSets = [...keysBySet.entries()]
    .filter(([, keys]) => AH_PROMPT_KEYS.every((key) => keys.has(key)))
    .map(([setVersion]) => setVersion)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return completeSets.length > 0 ? completeSets : [DEFAULT_PROMPT_SET_VERSION];
}

export async function insertAhPromptVersion(input: {
  promptKey: string;
  promptSetVersion?: string;
  template: string;
  createdBy?: string;
  changeReason?: string;
}): Promise<typeof ahPromptVersions.$inferSelect> {
  const promptSetVersion = normalizePromptSetVersion(input.promptSetVersion);

  await db
    .update(ahPromptVersions)
    .set({ isActive: false })
    .where(
      and(
        eq(ahPromptVersions.promptKey, input.promptKey),
        eq(ahPromptVersions.promptSetVersion, promptSetVersion),
        eq(ahPromptVersions.isActive, true),
      ),
    );

  const nextVersion = (await getLatestAhVersionNumber(input.promptKey, promptSetVersion)) + 1;

  const [created] = await db
    .insert(ahPromptVersions)
    .values({
      promptKey: input.promptKey,
      promptSetVersion,
      version: nextVersion,
      template: input.template,
      isActive: true,
      createdBy: input.createdBy ?? "seed",
      changeReason: input.changeReason,
    })
    .returning();

  return created;
}
