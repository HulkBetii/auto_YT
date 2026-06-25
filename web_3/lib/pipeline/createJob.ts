import { getActiveDrPromptVersion } from "@/lib/db/repo/prompt-versions";
import { createDrJob, findDrJobByCause } from "@/lib/db/repo/jobs";
import { getDrConfigValue } from "@/lib/db/repo/channel-config";
import { DR_CONFIG_KEYS } from "@/lib/db/schema";
import { interpolate } from "@/lib/utils/template";

const DEFAULT_WEB3_URL = "http://localhost:3002";

async function getWebCallbackBaseUrl(): Promise<string> {
  const configuredUrl = (await getDrConfigValue(DR_CONFIG_KEYS.web3Url))?.trim();
  const envUrl = process.env.WEB3_URL?.trim();
  return (configuredUrl || envUrl || DEFAULT_WEB3_URL).replace(/\/+$/, "");
}

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
  const webCallbackBaseUrl = await getWebCallbackBaseUrl();

  const metadata: Record<string, unknown> = {
    ...input.metadata,
    web_callback_url: `${webCallbackBaseUrl}/api/cron/process-jobs`,
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
