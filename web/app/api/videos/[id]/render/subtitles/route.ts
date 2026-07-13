import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { getRenderedSubtitlePath } from "@/lib/render/files";

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
    .select({ id: videos.id })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const filePath = getRenderedSubtitlePath(videoId);
  let fileSize: number;
  try {
    fileSize = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: "Subtitle file is missing" }, { status: 404 });
  }
  if (fileSize <= 0) {
    return NextResponse.json({ error: "Subtitle file is empty" }, { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-subrip; charset=utf-8",
      "Content-Disposition": `attachment; filename="video-${videoId}.srt"`,
      "Content-Length": String(fileSize),
      "Cache-Control": "private, no-store",
    },
  });
}
