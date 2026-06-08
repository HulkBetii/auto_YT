import { getActivePromptVersion } from "../db/repo/prompt-versions";
import { createJob as insertJob, findJobByCause } from "../db/repo/jobs";
import type { jobStageEnum, promptKeyEnum } from "../db/schema";
import { interpolate } from "./template";

type PromptKey = (typeof promptKeyEnum.enumValues)[number];
type JobStage = (typeof jobStageEnum.enumValues)[number];

/**
 * Resolves the active prompt_versions row for `promptKey`, interpolates `vars`
 * into its template, and inserts a job carrying a fully pre-resolved
 * `prompt_text` + `prompt_version_id` snapshot — see jobs.ts comment on why
 * the snapshot (not a live FK lookup) is what makes retries consistent.
 *
 * Idempotency: pass `causedByJobId` (the id of the job whose handler is
 * calling this — i.e. `job.id` from inside chain.ts's `handle*Done`) and this
 * will first check `findJobByCause` for an existing (cause, stage, video)
 * triple, returning it instead of inserting a duplicate. This is what guards
 * the chain.ts "KNOWN RISK" scenario: a `processDoneJob` that crashes after
 * successfully enqueueing the next stage but before `markJobConsumed` would,
 * without this check, re-run the whole handler on the next cron tick and
 * insert a second downstream job (double-scoring, duplicate notifications,
 * etc). Callers that omit `causedByJobId` get the old unconditional-insert
 * behavior — only chain.ts's handlers are expected to pass it.
 */
export async function enqueueStage(input: {
  promptKey: PromptKey;
  stage: JobStage;
  vars: Record<string, string>;
  videoId?: number;
  metadata?: unknown;
  causedByJobId?: number;
}) {
  if (input.causedByJobId != null) {
    const existing = await findJobByCause(input.causedByJobId, input.stage, input.videoId);
    if (existing) return existing;
  }

  const activeVersion = await getActivePromptVersion(input.promptKey);
  if (!activeVersion) {
    throw new Error(`No active prompt_versions row for prompt_key=${input.promptKey}`);
  }

  const promptText = interpolate(activeVersion.template, input.vars);

  const metadata =
    input.causedByJobId != null
      ? { ...((input.metadata as Record<string, unknown> | undefined) ?? {}), causedByJobId: input.causedByJobId }
      : input.metadata;

  return insertJob({
    videoId: input.videoId,
    stage: input.stage,
    promptText,
    promptVersionId: activeVersion.id,
    metadata,
  });
}
