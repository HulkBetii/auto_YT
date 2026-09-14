import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { koJpPromptVersions, type KoJpPromptVersion } from "@/lib/db/schema";

export async function getActivePromptVersion(promptKey: string): Promise<KoJpPromptVersion | null> {
  const [row] = await db
    .select()
    .from(koJpPromptVersions)
    .where(and(eq(koJpPromptVersions.promptKey, promptKey), eq(koJpPromptVersions.isActive, true)))
    .limit(1);
  return row ?? null;
}

export async function getPromptVersionById(id: number): Promise<KoJpPromptVersion | null> {
  const [row] = await db
    .select()
    .from(koJpPromptVersions)
    .where(eq(koJpPromptVersions.id, id))
    .limit(1);
  return row ?? null;
}

export async function listPromptVersions(promptKey?: string): Promise<KoJpPromptVersion[]> {
  if (promptKey) {
    return db
      .select()
      .from(koJpPromptVersions)
      .where(eq(koJpPromptVersions.promptKey, promptKey))
      .orderBy(desc(koJpPromptVersions.version));
  }
  return db
    .select()
    .from(koJpPromptVersions)
    .orderBy(koJpPromptVersions.promptKey, desc(koJpPromptVersions.version));
}
