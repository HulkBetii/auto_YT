import { count, desc, eq, gte } from "drizzle-orm";

import { db } from "../index";
import { videos, type videoStatusEnum } from "../schema";

type VideoStatus = (typeof videoStatusEnum.enumValues)[number];

export async function getVideo(videoId: number) {
  const [row] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  return row ?? null;
}

export async function listRecentVideos(limit = 20) {
  return db.select().from(videos).orderBy(desc(videos.createdAt)).limit(limit);
}

export async function listVideosByStatus(status: VideoStatus) {
  return db.select().from(videos).where(eq(videos.status, status)).orderBy(videos.createdAt);
}

export async function updateVideoStatus(
  videoId: number,
  status: VideoStatus,
  extra?: Partial<typeof videos.$inferInsert>,
) {
  await db
    .update(videos)
    .set({ status, ...extra })
    .where(eq(videos.id, videoId));
}

export async function createVideo(input: typeof videos.$inferInsert) {
  const [created] = await db.insert(videos).values(input).returning();
  return created;
}

export async function updateVideoAudioUrl(videoId: number, audioUrl: string) {
  await db.update(videos).set({ audioUrl, ttsTaskId: null }).where(eq(videos.id, videoId));
}

export async function setVideoTtsTaskId(videoId: number, taskId: string) {
  await db.update(videos).set({ ttsTaskId: taskId }).where(eq(videos.id, videoId));
}

export async function clearVideoTtsTaskId(videoId: number) {
  await db.update(videos).set({ ttsTaskId: null }).where(eq(videos.id, videoId));
}

/** Count videos created at or after `since`. Used by the P1 crash-dup tripwire. */
export async function countVideosCreatedSince(since: Date): Promise<number> {
  const [row] = await db.select({ n: count() }).from(videos).where(gte(videos.createdAt, since));
  return row?.n ?? 0;
}
