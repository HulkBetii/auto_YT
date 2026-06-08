import { getActivePromptVersion } from "../db/repo/prompt-versions";
import { createJob as insertJob } from "../db/repo/jobs";
import type { jobStageEnum, promptKeyEnum } from "../db/schema";
import { interpolate } from "./template";

type PromptKey = (typeof promptKeyEnum.enumValues)[number];
type JobStage = (typeof jobStageEnum.enumValues)[number];

/**
 * Resolves the active prompt_versions row for `promptKey`, interpolates `vars`
 * into its template, and inserts a job carrying a fully pre-resolved
 * `prompt_text` + `prompt_version_id` snapshot — see jobs.ts comment on why
 * the snapshot (not a live FK lookup) is what makes retries consistent.
 */
export async function enqueueStage(input: {
  promptKey: PromptKey;
  stage: JobStage;
  vars: Record<string, string>;
  videoId?: number;
  metadata?: unknown;
}) {
  const activeVersion = await getActivePromptVersion(input.promptKey);
  if (!activeVersion) {
    throw new Error(`No active prompt_versions row for prompt_key=${input.promptKey}`);
  }

  const promptText = interpolate(activeVersion.template, input.vars);

  return insertJob({
    videoId: input.videoId,
    stage: input.stage,
    promptText,
    promptVersionId: activeVersion.id,
    metadata: input.metadata,
  });
}
