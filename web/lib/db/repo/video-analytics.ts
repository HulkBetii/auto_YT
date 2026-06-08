import { desc, eq } from "drizzle-orm";

import { db } from "../index";
import { videoAnalytics } from "../schema";

export async function saveAnalyticsSnapshot(input: {
  videoId: number;
  views: number;
  likes?: number | null;
  comments?: number | null;
  ctrBasisPoints?: number | null;
  averageViewDurationSeconds?: number | null;
}) {
  const [created] = await db.insert(videoAnalytics).values(input).returning();
  return created;
}

export async function getLatestAnalytics(videoId: number) {
  const [row] = await db
    .select()
    .from(videoAnalytics)
    .where(eq(videoAnalytics.videoId, videoId))
    .orderBy(desc(videoAnalytics.fetchedAt))
    .limit(1);
  return row ?? null;
}
