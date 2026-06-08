import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { videoAnalytics } from "@/lib/db/schema";

const bodySchema = z.object({
  ctrPct: z.number().min(0).max(100),
  avdMinutes: z.number().min(0),
});

/**
 * Manual entry for CTR / average-view-duration — the YouTube Data API key alone
 * can't provide these (they require Analytics OAuth, see lib/youtube/client.ts),
 * so the dashboard is the intended input path. Updates the most recent
 * analytics snapshot in place rather than inserting a duplicate row.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const videoId = Number.parseInt(id, 10);
  if (!Number.isFinite(videoId)) return NextResponse.json({ ok: false, error: "ID video không hợp lệ" }, { status: 400 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });

  const [latest] = await db
    .select()
    .from(videoAnalytics)
    .where(eq(videoAnalytics.videoId, videoId))
    .orderBy(desc(videoAnalytics.fetchedAt))
    .limit(1);
  if (!latest) {
    return NextResponse.json({ ok: false, error: "Video này chưa có dữ liệu analytics nào" }, { status: 404 });
  }

  await db
    .update(videoAnalytics)
    .set({
      ctrBasisPoints: Math.round(parsed.data.ctrPct * 100),
      averageViewDurationSeconds: Math.round(parsed.data.avdMinutes * 60),
    })
    .where(eq(videoAnalytics.id, latest.id));

  return NextResponse.json({ ok: true });
}
