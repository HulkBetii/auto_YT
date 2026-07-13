import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import {
  buildRenderQueueReset,
  parseRenderAction,
} from "@/lib/render/state";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const videoId = Number.parseInt((await params).id, 10);
  if (!Number.isSafeInteger(videoId) || videoId <= 0) {
    return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
  }
  const action = parseRenderAction(await request.json().catch(() => null));
  if (!action) {
    return NextResponse.json({ error: "Invalid render action" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    const [video] = await tx
      .select({
        audioUrl: videos.audioUrl,
        ttsText: videos.ttsText,
        renderStatus: videos.renderStatus,
      })
      .from(videos)
      .where(eq(videos.id, videoId))
      .for("update")
      .limit(1);
    if (!video) return { error: "Video not found", status: 404 };
    if (video.renderStatus === "rendering") {
      return { error: "Video is currently rendering", status: 409 };
    }
    if (!video.audioUrl || !video.ttsText) {
      return {
        error: "Video needs both audio_url and tts_text before rendering",
        status: 409,
      };
    }
    if (action === "retry" && video.renderStatus !== "failed") {
      return {
        error: "Retry is only valid for a failed render",
        status: 409,
      };
    }

    await tx
      .update(videos)
      .set(buildRenderQueueReset())
      .where(eq(videos.id, videoId));
    return { error: null, status: 200 };
  });
  if (result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, status: "not_started" });
}
