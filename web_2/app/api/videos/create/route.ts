import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createAhVideo,
  formatRecentAhTopicsForPrompt,
  listRecentAhTopicSummaries,
} from "@/lib/db/repo/videos";
import { enqueueAhStage } from "@/lib/pipeline/createJob";

export async function POST(request: Request) {
  const secret = process.env.DASHBOARD_SECRET;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  const bearer = request.headers.get("authorization");

  const authed = !secret || auth === secret || bearer === `Bearer ${secret}`;
  if (!authed) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const video = await createAhVideo({ status: "s1_pending" });
    const recentTopics = await listRecentAhTopicSummaries(30, video.id);

    await enqueueAhStage({
      promptKey: "S1",
      stage: "S1",
      vars: {
        RECENT_TOPICS: formatRecentAhTopicsForPrompt(recentTopics),
      },
      videoId: video.id,
    });

    return NextResponse.json({ ok: true, videoId: video.id }, { status: 201 });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[videos/create]", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
