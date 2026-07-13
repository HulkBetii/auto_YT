import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { getRenderedVideoPath, parseByteRange } from "@/lib/render/files";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const videoId = Number.parseInt((await params).id, 10);
  if (!Number.isSafeInteger(videoId) || videoId <= 0) {
    return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
  }
  const [video] = await db
    .select({ id: videos.id, videoPath: videos.videoPath })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);
  if (!video || !video.videoPath) {
    return NextResponse.json({ error: "Rendered video not found" }, { status: 404 });
  }

  const filePath = getRenderedVideoPath(videoId);
  let fileSize: number;
  try {
    fileSize = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: "Rendered video file is missing" }, { status: 404 });
  }
  if (fileSize <= 0) {
    return NextResponse.json({ error: "Rendered video file is empty" }, { status: 404 });
  }
  const download = request.nextUrl.searchParams.get("download") === "1";
  const range = request.headers.get("range");
  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Content-Type": "video/mp4",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="video-${videoId}.mp4"`,
    "Cache-Control": "private, no-store",
  };

  if (!range) {
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: { ...commonHeaders, "Content-Length": String(fileSize) },
    });
  }

  const parsedRange = parseByteRange(range, fileSize);
  if (!parsedRange) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${fileSize}` },
    });
  }
  const { start, end } = parsedRange;

  const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
  return new Response(stream, {
    status: 206,
    headers: {
      ...commonHeaders,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    },
  });
}
