import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../index";
import { ahVideos, type AhVideoStatus, IN_PIPELINE_STATUSES } from "../schema";

export async function createAhVideo(input: typeof ahVideos.$inferInsert) {
  const [created] = await db.insert(ahVideos).values(input).returning();
  return created;
}

export async function getAhVideo(videoId: number) {
  const [row] = await db.select().from(ahVideos).where(eq(ahVideos.id, videoId)).limit(1);
  return row ?? null;
}

export async function listAhVideos(filter?: { status?: AhVideoStatus }, limit = 30) {
  let q = db.select().from(ahVideos).$dynamic();
  if (filter?.status) {
    q = q.where(eq(ahVideos.status, filter.status));
  }
  return q.orderBy(desc(ahVideos.createdAt)).limit(limit);
}

export async function updateAhVideoStatus(videoId: number, status: AhVideoStatus) {
  await db
    .update(ahVideos)
    .set({ status, updatedAt: new Date() })
    .where(eq(ahVideos.id, videoId));
}

export async function updateAhVideoFields(
  videoId: number,
  fields: Partial<typeof ahVideos.$inferInsert>,
) {
  await db
    .update(ahVideos)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(ahVideos.id, videoId));
}

export async function countAhVideosByStatus(): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: ahVideos.status, n: count() })
    .from(ahVideos)
    .groupBy(ahVideos.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export async function listInPipelineAhVideos() {
  return db
    .select()
    .from(ahVideos)
    .where(inArray(ahVideos.status, IN_PIPELINE_STATUSES))
    .orderBy(desc(ahVideos.createdAt));
}

/**
 * Atomically sets audioUrl = 'tts_submitting' only if it is currently NULL.
 * Returns true if this caller won the race; false if another cycle already claimed it.
 * Prevents duplicate TTS submissions when multiple cron cycles overlap.
 */
export async function claimVideoForTtsSubmit(videoId: number): Promise<boolean> {
  const result = await db
    .update(ahVideos)
    .set({ audioUrl: "tts_submitting", updatedAt: new Date() })
    .where(and(eq(ahVideos.id, videoId), sql`${ahVideos.audioUrl} IS NULL`))
    .returning({ id: ahVideos.id });
  return result.length > 0;
}

export async function listNeedsAttentionAhVideos() {
  return db
    .select()
    .from(ahVideos)
    .where(eq(ahVideos.status, "needs_attention"))
    .orderBy(desc(ahVideos.updatedAt));
}

export async function deleteAhVideo(videoId: number) {
  // Delete child jobs first (FK constraint), then the video
  await db.execute(sql`DELETE FROM ah_jobs WHERE video_id = ${videoId}`);
  const [deleted] = await db.delete(ahVideos).where(eq(ahVideos.id, videoId)).returning({ id: ahVideos.id });
  return deleted ?? null;
}

export async function updateVideoProgress(
  videoId: number,
  update: {
    status: AhVideoStatus;
    imageCount?: number;
    imageCountExpected?: number;
    videoPath?: string;
  },
) {
  const current = await getAhVideo(videoId);
  if (!current) return;

  const nextImageCount = update.imageCount ?? current.imageCount;
  const nextImageCountExpected = update.imageCountExpected ?? current.imageCountExpected;
  const nextVideoPath = update.videoPath ?? current.videoPath;
  const imageCountIncreased =
    update.imageCount !== undefined && update.imageCount > (current.imageCount ?? 0);

  // When stuck in needs_attention, only allow forward-progress transitions:
  // imageCount increase, or explicit terminal statuses (assembly_pending/done).
  if (
    current.status === "needs_attention" &&
    update.status !== "needs_attention" &&
    update.status !== "assembly_pending" &&
    update.status !== "assembly_done" &&
    !imageCountIncreased
  ) {
    return;
  }

  const statusChanged = current.status !== update.status;
  const hasMeaningfulChange =
    statusChanged ||
    nextImageCount !== current.imageCount ||
    nextImageCountExpected !== current.imageCountExpected ||
    nextVideoPath !== current.videoPath;

  if (!hasMeaningfulChange) return;

  await db
    .update(ahVideos)
    .set({
      // Only write status when it actually changed — prevents a delayed report
      // from a previous pipeline stage from regressing the video backward.
      ...(statusChanged && { status: update.status }),
      ...(update.imageCount !== undefined && { imageCount: update.imageCount }),
      ...(update.imageCountExpected !== undefined && { imageCountExpected: update.imageCountExpected }),
      ...(update.videoPath !== undefined && { videoPath: update.videoPath }),
      updatedAt: new Date(),
    })
    .where(eq(ahVideos.id, videoId));
}

export async function listAssemblyDoneAhVideos() {
  return db
    .select()
    .from(ahVideos)
    .where(eq(ahVideos.status, "assembly_done"))
    .orderBy(desc(ahVideos.updatedAt));
}

export async function bulkDeleteAhVideos(videoIds: number[]) {
  if (videoIds.length === 0) return 0;
  await db.execute(sql`DELETE FROM ah_jobs WHERE video_id = ANY(${videoIds}::int[])`);
  const deleted = await db.delete(ahVideos).where(inArray(ahVideos.id, videoIds)).returning({ id: ahVideos.id });
  return deleted.length;
}
