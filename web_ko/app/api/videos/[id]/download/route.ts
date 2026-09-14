import { NextResponse } from "next/server";

import { isDashboardAuthorized } from "@/lib/auth";
import { getKoVideo } from "@/lib/db/repo/videos";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isDashboardAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const videoId = Number((await params).id);
  const video = Number.isInteger(videoId) ? await getKoVideo(videoId) : null;
  if (!video?.finalScriptPath || !video.finalScript) {
    return NextResponse.json({ ok: false, error: "Final script is not ready." }, { status: 404 });
  }
  return new Response(`${video.finalScript.trim()}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="ko-script-${video.id}.txt"`,
    },
  });
}
