import { NextResponse } from "next/server";

import { isDashboardAuthorized } from "@/lib/auth";
import { getKoVideo, listKoJobsByVideo, listKoSections } from "@/lib/db/repo/videos";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isDashboardAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const videoId = Number((await params).id);
  if (!Number.isInteger(videoId)) {
    return NextResponse.json({ ok: false, error: "Invalid video ID" }, { status: 400 });
  }
  const video = await getKoVideo(videoId);
  if (!video) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const [sections, jobs] = await Promise.all([listKoSections(videoId), listKoJobsByVideo(videoId)]);
  return NextResponse.json({ ok: true, video, sections, jobs });
}
