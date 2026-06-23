import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

import { getDrEpisode, updateDrEpisodeFields } from "@/lib/db/repo/episodes";

const BodySchema = z.object({
  published: z.boolean(),
  youtubeUrl: z.string().trim().url().optional().or(z.literal("")),
});

async function assertAuth(request: Request): Promise<boolean> {
  const secret = process.env.DASHBOARD_SECRET;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  const bearer = request.headers.get("authorization");
  return !secret || auth === secret || bearer === `Bearer ${secret}`;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertAuth(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const videoId = parseInt(id, 10);
  if (isNaN(videoId)) {
    return NextResponse.json({ ok: false, error: "Invalid video ID" }, { status: 400 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const video = await getDrEpisode(videoId);
  if (!video) {
    return NextResponse.json({ ok: false, error: "Video not found" }, { status: 404 });
  }

  if (body.published) {
    await updateDrEpisodeFields(videoId, {
      // Keep an existing publish time if re-saving (e.g. only updating the URL).
      publishedAt: video.publishedAt ?? new Date(),
      youtubeUrl: body.youtubeUrl ? body.youtubeUrl : null,
    });
  } else {
    await updateDrEpisodeFields(videoId, { publishedAt: null, youtubeUrl: null });
  }

  return NextResponse.json({ ok: true, videoId, published: body.published });
}
