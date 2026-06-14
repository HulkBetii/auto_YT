import { and, desc, eq } from "drizzle-orm";

import { db } from "../index";
import { ahPromptVersions } from "../schema";

export async function getActiveAhPromptVersion(promptKey: string) {
  const [row] = await db
    .select()
    .from(ahPromptVersions)
    .where(
      and(eq(ahPromptVersions.promptKey, promptKey), eq(ahPromptVersions.isActive, true)),
    )
    .limit(1);
  return row ?? null;
}

export async function getLatestAhVersionNumber(promptKey: string): Promise<number> {
  const [row] = await db
    .select({ version: ahPromptVersions.version })
    .from(ahPromptVersions)
    .where(eq(ahPromptVersions.promptKey, promptKey))
    .orderBy(desc(ahPromptVersions.version))
    .limit(1);
  return row?.version ?? 0;
}

export async function insertAhPromptVersion(input: {
  promptKey: string;
  template: string;
  createdBy?: string;
  changeReason?: string;
}): Promise<typeof ahPromptVersions.$inferSelect> {
  await db
    .update(ahPromptVersions)
    .set({ isActive: false })
    .where(
      and(
        eq(ahPromptVersions.promptKey, input.promptKey),
        eq(ahPromptVersions.isActive, true),
      ),
    );

  const nextVersion = (await getLatestAhVersionNumber(input.promptKey)) + 1;

  const [created] = await db
    .insert(ahPromptVersions)
    .values({
      promptKey: input.promptKey,
      version: nextVersion,
      template: input.template,
      isActive: true,
      createdBy: input.createdBy ?? "seed",
      changeReason: input.changeReason,
    })
    .returning();

  return created;
}
