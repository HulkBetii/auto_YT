import { and, count, desc, eq, inArray } from "drizzle-orm";

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
