import { db } from "@/lib/db";
import {
  getKoJpVideo,
  updateKoJpVideo,
  listKoJpSections,
} from "@/lib/db/repo/videos";
import {
  createKoJpJob,
  findJobByCause,
} from "@/lib/db/repo/jobs";
import { getActivePromptVersion } from "@/lib/db/repo/prompts";
import {
  REQUIRED_MODEL,
  AUDIT_EFFORT,
  OUTLINE_EFFORT,
  SCRIPT_EFFORT,
  REVIEW_EFFORT,
} from "@/lib/pipeline/default-prompts";

export async function advanceVideoPipeline(videoId: number, causedByJobId?: number): Promise<{ success: boolean; message: string }> {
  const video = await getKoJpVideo(videoId);
  if (!video) {
    return { success: false, message: `Video #${videoId} not found.` };
  }

  if (video.status === "source_pending") {
    if (!video.transcriptText) {
      return { success: false, message: "No transcript provided yet." };
    }
    const auditPrompt = await getActivePromptVersion("source_audit");
    if (!auditPrompt) {
      return { success: false, message: "Active source_audit prompt not found." };
    }

    if (causedByJobId) {
      const existing = await findJobByCause(causedByJobId, "source_audit", video.id);
      if (existing) return { success: true, message: "Source audit job already enqueued." };
    }

    const populatedPrompt = auditPrompt.template.replace("[TRANSCRIPT]", video.transcriptText);
    await createKoJpJob({
      videoId: video.id,
      stage: "source_audit",
      modelLabel: REQUIRED_MODEL,
      effort: AUDIT_EFFORT,
      promptText: populatedPrompt,
      promptVersionId: auditPrompt.id,
      promptSnapshot: populatedPrompt,
      causedByJobId,
    });

    await updateKoJpVideo(video.id, {
      status: "source_audit_pending",
      sourceAuditPromptVersionId: auditPrompt.id,
    });

    return { success: true, message: `Enqueued source audit for video #${video.id}.` };
  }

  return { success: true, message: `Video #${videoId} is currently in state '${video.status}'.` };
}
