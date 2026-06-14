import { getActiveAhPromptVersion } from "@/lib/db/repo/prompt-versions";
import { createAhJob, findAhJobByCause } from "@/lib/db/repo/jobs";
import { interpolate } from "@/lib/utils/template";

const WEB2_URL = process.env.WEB2_URL ?? "http://localhost:3001";

export async function enqueueAhStage(input: {
  promptKey: string;
  stage: string;
  vars: Record<string, string>;
  videoId?: number;
  causedByJobId?: number;
  metadata?: Record<string, unknown>;
}) {
  // Idempotency guard: if this exact cause already produced a job for this stage, skip
  if (input.causedByJobId != null) {
    const existing = await findAhJobByCause(input.causedByJobId, input.stage, input.videoId);
    if (existing) {
      console.log(
        `[createJob] Skipped duplicate: stage=${input.stage} causedByJobId=${input.causedByJobId} → job#${existing.id}`,
      );
      return existing;
    }
  }

  const promptVersion = await getActiveAhPromptVersion(input.promptKey);
  if (!promptVersion) {
    throw new Error(`[createJob] No active prompt version for key "${input.promptKey}"`);
  }

  const promptText = interpolate(promptVersion.template, input.vars);

  const metadata: Record<string, unknown> = {
    ...input.metadata,
    web_callback_url: `${WEB2_URL}/api/cron/process-jobs`,
  };
  if (input.causedByJobId != null) {
    metadata.causedByJobId = input.causedByJobId;
  }

  const job = await createAhJob({
    videoId: input.videoId,
    stage: input.stage,
    promptText,
    metadata,
  });

  console.log(`[createJob] Enqueued stage=${input.stage} videoId=${input.videoId} job#${job.id}`);
  return job;
}
