import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  koJobs,
  koSections,
  koVideos,
  type KoSection,
  type KoVideoStatus,
} from "@/lib/db/schema";

export async function createKoVideo(input: {
  sourceUrl: string;
  sourceVideoId: string;
  sourceAuditPromptVersionId: number;
  outlinePromptVersionId: number;
  sectionPromptVersionId: number;
  fidelityPromptVersionId: number;
}) {
  const [created] = await db
    .insert(koVideos)
    .values({ ...input, status: "transcript_pending" })
    .returning();
  return created;
}

export async function getKoVideo(videoId: number) {
  const [row] = await db.select().from(koVideos).where(eq(koVideos.id, videoId)).limit(1);
  return row ?? null;
}

export async function listKoVideos(input: { status?: KoVideoStatus; limit?: number } = {}) {
  const limit = input.limit ?? 100;
  return input.status
    ? db
        .select()
        .from(koVideos)
        .where(eq(koVideos.status, input.status))
        .orderBy(desc(koVideos.createdAt))
        .limit(limit)
    : db.select().from(koVideos).orderBy(desc(koVideos.createdAt)).limit(limit);
}

export async function getKoVideoStatusCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: koVideos.status, total: count() })
    .from(koVideos)
    .groupBy(koVideos.status);
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.total)]));
}

export async function updateKoVideo(
  videoId: number,
  fields: Partial<typeof koVideos.$inferInsert>,
) {
  const [updated] = await db
    .update(koVideos)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(koVideos.id, videoId))
    .returning();
  return updated ?? null;
}

export async function markKoVideoNeedsAttention(
  videoId: number,
  errorCode: string,
  errorMessage: string,
) {
  return updateKoVideo(videoId, {
    status: "needs_attention",
    errorCode,
    errorMessage: errorMessage.slice(0, 4000),
  });
}

export async function listVideosAwaitingTranscript() {
  return db
    .select()
    .from(koVideos)
    .where(
      and(
        inArray(koVideos.status, ["transcript_pending", "transcribing"]),
        sql`${koVideos.transcriptJobId} is not null`,
      ),
    )
    .orderBy(asc(koVideos.createdAt));
}

export async function initializeKoSections(
  videoId: number,
  sections: Array<{ index: number; kind: string; outlineData: unknown }>,
): Promise<KoSection[]> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(koSections)
      .where(eq(koSections.videoId, videoId))
      .orderBy(asc(koSections.sectionIndex));
    if (existing.length > 0) return existing;

    return tx
      .insert(koSections)
      .values(
        sections.map((section) => ({
          videoId,
          sectionIndex: section.index,
          kind: section.kind,
          outlineData: section.outlineData,
        })),
      )
      .returning();
  });
}

export async function listKoSections(videoId: number) {
  return db
    .select()
    .from(koSections)
    .where(eq(koSections.videoId, videoId))
    .orderBy(asc(koSections.sectionIndex));
}

export async function getKoSection(sectionId: number) {
  const [row] = await db.select().from(koSections).where(eq(koSections.id, sectionId)).limit(1);
  return row ?? null;
}

export async function getFirstIncompleteKoSection(videoId: number) {
  const [row] = await db
    .select()
    .from(koSections)
    .where(and(eq(koSections.videoId, videoId), sql`${koSections.status} <> 'ready'`))
    .orderBy(asc(koSections.sectionIndex))
    .limit(1);
  return row ?? null;
}

export async function getPreviousKoSection(videoId: number, sectionIndex: number) {
  const [row] = await db
    .select()
    .from(koSections)
    .where(and(eq(koSections.videoId, videoId), eq(koSections.sectionIndex, sectionIndex - 1)))
    .limit(1);
  return row ?? null;
}

export async function updateKoSection(
  sectionId: number,
  fields: Partial<typeof koSections.$inferInsert>,
) {
  const [updated] = await db
    .update(koSections)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(koSections.id, sectionId))
    .returning();
  return updated ?? null;
}

export async function listKoJobsByVideo(videoId: number) {
  return db
    .select()
    .from(koJobs)
    .where(eq(koJobs.videoId, videoId))
    .orderBy(desc(koJobs.createdAt));
}
