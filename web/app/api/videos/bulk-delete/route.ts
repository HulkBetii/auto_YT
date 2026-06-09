import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { videoAnalytics, videoContent, jobs, videos } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { ids?: unknown };
  const ids = body.ids;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
  }
  const numIds = ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (numIds.length === 0) {
    return NextResponse.json({ error: "no valid ids" }, { status: 400 });
  }

  // Delete child records first (FK constraints), then parent videos
  // Must be sequential — neon-http has no transaction support
  await db.delete(videoAnalytics).where(inArray(videoAnalytics.videoId, numIds));
  await db.delete(videoContent).where(inArray(videoContent.videoId, numIds));
  await db.delete(jobs).where(inArray(jobs.videoId, numIds));
  const deleted = await db.delete(videos).where(inArray(videos.id, numIds)).returning({ id: videos.id });

  return NextResponse.json({ deleted: deleted.length, ids: deleted.map((r) => r.id) });
}
