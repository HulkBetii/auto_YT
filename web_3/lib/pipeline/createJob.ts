import { getActiveDrPromptVersion } from "@/lib/db/repo/prompt-versions";
import { createDrJob, findDrJobByCause } from "@/lib/db/repo/jobs";
import { interpolate } from "@/lib/utils/template";

const WEB3_URL = process.env.WEB3_URL ?? "http://localhost:3002";

export async function enqueueDrStage(input: {
  promptKey: string;
  stage: string;
  vars: Record<string, string>;
  episodeId?: number;
  causedByJobId?: number;
  metadata?: Record<string, unknown>;
}) {
  // Idempotency guard: if this exact cause already produced a job for this stage, skip
  if (input.causedByJobId != null) {
    const existing = await findDrJobByCause(input.causedByJobId, input.stage, input.episodeId);
    if (existing) {
      console.log(
        `[createJob] Skipped duplicate: stage=${input.stage} causedByJobId=${input.causedByJobId} → job#${existing.id}`,
      );
      return existing;
    }
  }

  const promptVersion = await getActiveDrPromptVersion(input.promptKey);
  if (!promptVersion) {
    throw new Error(`[createJob] No active prompt version for key "${input.promptKey}"`);
  }

  const promptText = interpolate(promptVersion.template, input.vars);

  const metadata: Record<string, unknown> = {
    ...input.metadata,
    web_callback_url: `${WEB3_URL}/api/cron/process-jobs`,
  };
  if (input.causedByJobId != null) {
    metadata.causedByJobId = input.causedByJobId;
  }

  const job = await createDrJob({
    episodeId: input.episodeId,
    stage: input.stage,
    promptText,
    metadata,
  });

  console.log(`[createJob] Enqueued stage=${input.stage} episodeId=${input.episodeId} job#${job.id}`);
  return job;
}
