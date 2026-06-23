import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDrEpisode, updateDrEpisodeFields } from "@/lib/db/repo/episodes";
import type { EpisodeTrackAudio } from "@/lib/db/schema";

async function assertAuth(request: Request) {
  const secret = process.env.DASHBOARD_SECRET;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  const bearer = request.headers.get("authorization");
  return !secret || auth === secret || bearer === `Bearer ${secret}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; idx: string }> },
) {
  if (!(await assertAuth(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id, idx } = await params;
  const episodeId = parseInt(id, 10);
  const specIndex = parseInt(idx, 10);
  if (isNaN(episodeId) || isNaN(specIndex)) {
    return NextResponse.json({ ok: false, error: "Invalid id/idx" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { clipIndex?: number };
  const clipIndex = body.clipIndex;
  if (typeof clipIndex !== "number" || clipIndex < 0) {
    return NextResponse.json({ ok: false, error: "clipIndex required" }, { status: 400 });
  }

  const episode = await getDrEpisode(episodeId);
  if (!episode) return NextResponse.json({ ok: false, error: "Episode not found" }, { status: 404 });

  const audio = (episode.audio as EpisodeTrackAudio[] | null) ?? [];
  const track = audio.find((t) => t.specIndex === specIndex);
  if (!track) return NextResponse.json({ ok: false, error: "Track not found" }, { status: 404 });
  if (clipIndex >= track.clips.length) {
    return NextResponse.json({ ok: false, error: "clipIndex out of range" }, { status: 400 });
  }

  track.primaryClipIndex = clipIndex;
  await updateDrEpisodeFields(episodeId, { audio });

  return NextResponse.json({ ok: true, specIndex, clipIndex });
}
