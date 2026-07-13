import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import {
  renderedSubtitleExists,
  renderedVideoExists,
} from "@/lib/render/files";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const videoId = Number.parseInt((await params).id, 10);
  if (!Number.isSafeInteger(videoId) || videoId <= 0) {
    return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
  }

  const [video] = await db
    .select({
      id: videos.id,
      audioUrl: videos.audioUrl,
      ttsText: videos.ttsText,
      renderStatus: videos.renderStatus,
      renderError: videos.renderError,
      renderAttemptCount: videos.renderAttemptCount,
      renderNextAttemptAt: videos.renderNextAttemptAt,
      renderRequestedAt: videos.renderRequestedAt,
      renderStartedAt: videos.renderStartedAt,
      renderFinishedAt: videos.renderFinishedAt,
      renderHeartbeatAt: videos.renderHeartbeatAt,
      renderedAudioUrl: videos.renderedAudioUrl,
    })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const [outputAvailable, subtitleAvailable] = await Promise.all([
    renderedVideoExists(videoId),
    renderedSubtitleExists(videoId),
  ]);
  const { ttsText, ...status } = video;
  return NextResponse.json({
    ...status,
    outputAvailable,
    subtitleAvailable,
    outputCurrent:
      outputAvailable &&
      video.renderStatus === "done" &&
      video.audioUrl === video.renderedAudioUrl,
    waitingForAudio: !video.audioUrl,
    missingTtsText: Boolean(video.audioUrl && !ttsText),
  });
}
