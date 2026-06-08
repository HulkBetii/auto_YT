import { desc, eq } from "drizzle-orm";

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
