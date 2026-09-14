import { NextResponse } from "next/server";

import { isDashboardAuthorized } from "@/lib/auth";
import { getLatestFailedKoJob, retryKoJob } from "@/lib/db/repo/jobs";
import { ensureDefaultPrompts, getActivePrompt } from "@/lib/db/repo/prompts";
import {
  getFirstIncompleteKoSection,
  getKoVideo,
  markKoVideoNeedsAttention,
  updateKoSection,
  updateKoVideo,
} from "@/lib/db/repo/videos";
import {
  enqueueFidelityRepairsForVideo,
  enqueueFidelityReviewForVideo,
  enqueueOutlineForVideo,
  enqueueSectionForVideo,
  enqueueSourceAuditForVideo,
  runKoChainCycle,
} from "@/lib/pipeline/chain";
import type { FidelityReview } from "@/lib/pipeline/validators";
import { submitTranscriptJob } from "@/lib/pipeline/yt-pro-max";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isDashboardAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const videoId = Number((await params).id);
  let video = Number.isInteger(videoId) ? await getKoVideo(videoId) : null;
  if (!video) return NextResponse.json({ ok: false, error: "Video not found" }, { status: 404 });

  try {
    if (!video.sourceAuditPromptVersionId || !video.fidelityPromptVersionId) {
      await ensureDefaultPrompts();
      const [sourceAuditPrompt, fidelityPrompt] = await Promise.all([
        getActivePrompt("source_audit"),
        getActivePrompt("fidelity_review"),
      ]);
      if (!sourceAuditPrompt || !fidelityPrompt) throw new Error("Audit prompts are unavailable.");
      video = await updateKoVideo(video.id, {
        sourceAuditPromptVersionId: video.sourceAuditPromptVersionId ?? sourceAuditPrompt.id,
        fidelityPromptVersionId: video.fidelityPromptVersionId ?? fidelityPrompt.id,
      });
      if (!video) throw new Error("Video disappeared while pinning audit prompts.");
    }

    const failedJob = await getLatestFailedKoJob(video.id);
    if (failedJob) {
      const retried = await retryKoJob(failedJob.id);
      if (!retried) throw new Error("The failed job can no longer be retried.");
      if (retried.sectionId) await updateKoSection(retried.sectionId, { status: "pending" });
      const retryStatus = {
        source_audit: "source_audit_pending",
        outline: "outline_pending",
        section: "sections_pending",
        fidelity_review: "final_review_pending",
      }[retried.kind] ?? "needs_attention";
      await updateKoVideo(video.id, {
        status: retryStatus,
        errorCode: null,
        errorMessage: null,
      });
      return NextResponse.json({ ok: true, mode: "job", jobId: retried.id });
    }

    if (!video.rawTranscriptText) {
      try {
        const transcriptJob = await submitTranscriptJob(video.sourceUrl);
        await updateKoVideo(video.id, {
          transcriptJobId: transcriptJob.id,
          status: "transcribing",
          errorCode: null,
          errorMessage: null,
        });
        await runKoChainCycle();
        return NextResponse.json({ ok: true, mode: "transcript" });
      } catch (error) {
        await markKoVideoNeedsAttention(
          video.id,
          "YT_PRO_MAX_UNAVAILABLE",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }

    if (!video.transcriptText || video.errorCode?.startsWith("SOURCE_")) {
      await updateKoVideo(video.id, {
        status: "source_audit_pending",
        errorCode: null,
        errorMessage: null,
      });
      await enqueueSourceAuditForVideo(video);
      return NextResponse.json({ ok: true, mode: "source_audit" });
    }

    if (video.errorCode === "OUTLINE_VALIDATION_FAILED") {
      await updateKoVideo(video.id, { status: "outline_pending", errorCode: null, errorMessage: null });
      await enqueueOutlineForVideo(video);
      return NextResponse.json({ ok: true, mode: "outline" });
    }

    if (video.errorCode === "SECTION_VALIDATION_FAILED") {
      const section = await getFirstIncompleteKoSection(video.id);
      if (!section) throw new Error("No incomplete section was found.");
      await enqueueSectionForVideo(video, section);
      return NextResponse.json({ ok: true, mode: "section", sectionId: section.id });
    }

    if (video.errorCode === "FIDELITY_REVIEW_FAILED") {
      const review = video.fidelityReview as (FidelityReview & { review_cycle?: number }) | null;
      if (!review || review.verdict !== "repair") {
        throw new Error("The failed fidelity review has no targeted repairs to retry.");
      }
      const result = await enqueueFidelityRepairsForVideo(video, review, {
        reviewCycle: Math.max(0, (review.review_cycle ?? 0) - 1),
      });
      return NextResponse.json({ ok: true, mode: "fidelity_repair", ...result });
    }

    if (video.errorCode?.startsWith("FIDELITY_")) {
      await enqueueFidelityReviewForVideo(video, {
        reviewCycle: Number((video.fidelityReview as { review_cycle?: number } | null)?.review_cycle ?? 0),
      });
      return NextResponse.json({ ok: true, mode: "fidelity_review" });
    }

    return NextResponse.json({ ok: false, error: "No retryable phase was found." }, { status: 409 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
