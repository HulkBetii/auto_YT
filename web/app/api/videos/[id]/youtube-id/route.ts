import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";

const bodySchema = z.object({
  youtubeVideoId: z.string().trim().min(1).max(64),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const videoId = Number.parseInt(id, 10);
  if (!Number.isFinite(videoId)) return NextResponse.json({ ok: false, error: "ID video không hợp lệ" }, { status: 400 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });

  await db
    .update(videos)
    .set({ youtubeVideoId: parsed.data.youtubeVideoId, publishedAt: new Date() })
    .where(eq(videos.id, videoId));

  return NextResponse.json({ ok: true });
}
