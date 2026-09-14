import { NextResponse } from "next/server";

import { isDashboardAuthorized } from "@/lib/auth";
import { ensureDefaultPrompts, getActivePrompt } from "@/lib/db/repo/prompts";
import {
  createKoVideo,
  listKoVideos,
  markKoVideoNeedsAttention,
  updateKoVideo,
} from "@/lib/db/repo/videos";
import { runKoChainCycle } from "@/lib/pipeline/chain";
import { submitTranscriptJob } from "@/lib/pipeline/yt-pro-max";
import { parseYouTubeUrl } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isDashboardAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, videos: await listKoVideos() });
}

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let parsedUrl: ReturnType<typeof parseYouTubeUrl>;
  try {
    const body = (await request.json()) as { url?: string };
    parsedUrl = parseYouTubeUrl(body.url ?? "");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  try {
    await ensureDefaultPrompts();
    const [sourceAuditPrompt, outlinePrompt, sectionPrompt, fidelityPrompt] = await Promise.all([
      getActivePrompt("source_audit"),
      getActivePrompt("outline"),
      getActivePrompt("section"),
      getActivePrompt("fidelity_review"),
    ]);
    if (!sourceAuditPrompt || !outlinePrompt || !sectionPrompt || !fidelityPrompt) {
      throw new Error("Active prompt versions are missing.");
    }

    const video = await createKoVideo({
      sourceUrl: parsedUrl.canonicalUrl,
      sourceVideoId: parsedUrl.videoId,
      sourceAuditPromptVersionId: sourceAuditPrompt.id,
      outlinePromptVersionId: outlinePrompt.id,
      sectionPromptVersionId: sectionPrompt.id,
      fidelityPromptVersionId: fidelityPrompt.id,
    });

    try {
      const transcriptJob = await submitTranscriptJob(parsedUrl.canonicalUrl);
      if (transcriptJob.status === "failed") {
        await markKoVideoNeedsAttention(
          video.id,
          transcriptJob.error?.code ?? "TRANSCRIPT_FAILED",
          transcriptJob.error?.message ?? "YT_Pro_Max rejected the transcript job.",
        );
      } else {
        await updateKoVideo(video.id, {
          transcriptJobId: transcriptJob.id,
          sourceTitle: transcriptJob.video?.title ?? null,
          status: "transcribing",
        });
        await runKoChainCycle().catch((error) => {
          console.warn("[videos] Initial chain cycle failed:", error);
        });
      }
    } catch (error) {
      await markKoVideoNeedsAttention(
        video.id,
        "YT_PRO_MAX_UNAVAILABLE",
        error instanceof Error ? error.message : String(error),
      );
    }

    return NextResponse.json({ ok: true, videoId: video.id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/videos]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
