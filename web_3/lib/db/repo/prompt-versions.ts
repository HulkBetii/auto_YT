import { and, desc, eq } from "drizzle-orm";

import { db } from "../index";
import { drPromptVersions } from "../schema";

export async function getActiveDrPromptVersion(promptKey: string) {
  const [row] = await db
    .select()
    .from(drPromptVersions)
    .where(
      and(eq(drPromptVersions.promptKey, promptKey), eq(drPromptVersions.isActive, true)),
    )
    .limit(1);
  return row ?? null;
}

export async function getLatestDrVersionNumber(promptKey: string): Promise<number> {
  const [row] = await db
    .select({ version: drPromptVersions.version })
    .from(drPromptVersions)
    .where(eq(drPromptVersions.promptKey, promptKey))
    .orderBy(desc(drPromptVersions.version))
    .limit(1);
  return row?.version ?? 0;
}

export async function insertDrPromptVersion(input: {
  promptKey: string;
  template: string;
  createdBy?: string;
  changeReason?: string;
}): Promise<typeof drPromptVersions.$inferSelect> {
  await db
    .update(drPromptVersions)
    .set({ isActive: false })
    .where(
      and(
        eq(drPromptVersions.promptKey, input.promptKey),
        eq(drPromptVersions.isActive, true),
      ),
    );

  const nextVersion = (await getLatestDrVersionNumber(input.promptKey)) + 1;

  const [created] = await db
    .insert(drPromptVersions)
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
