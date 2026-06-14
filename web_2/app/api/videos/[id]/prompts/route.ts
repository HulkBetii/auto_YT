import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAhVideo } from "@/lib/db/repo/videos";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const secret = process.env.DASHBOARD_SECRET;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;

  if (secret && auth !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const videoId = parseInt(id, 10);
  if (isNaN(videoId)) {
    return NextResponse.json({ ok: false, error: "Invalid video id" }, { status: 400 });
  }

  const video = await getAhVideo(videoId);
  if (!video) {
    return NextResponse.json({ ok: false, error: "Video not found" }, { status: 404 });
  }

  if (!video.imagePrompts) {
    return NextResponse.json({ ok: false, error: "Image prompts not ready yet" }, { status: 404 });
  }

  const slug = video.scriptSlug ?? `video_${videoId}`;
  const filename = `${slug}_image_prompts.txt`;

  return new Response(video.imagePrompts, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
