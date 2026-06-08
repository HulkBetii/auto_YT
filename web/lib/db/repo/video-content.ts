import { and, eq } from "drizzle-orm";

import { db } from "../index";
import { videoContent, type contentStageEnum } from "../schema";

type ContentStage = (typeof contentStageEnum.enumValues)[number];

/**
 * Inserts a video_content row for (video, stage) — but first checks for an
 * existing row with the EXACT SAME output for that (video, stage) and returns
 * it instead of inserting a duplicate.
 *
 * Why this is a safe + correct dedup key (no schema migration needed — see
 * chain.ts processDoneJob's docstring, which flagged this as a follow-up to
 * the causedByJobId guard added to enqueueStage): in the crash-then-rerun
 * scenario this guards against, `job.result` is the same persisted string on
 * both the original run and the re-run (it was written once by the worker's
 * `complete_job` and never changes), so the output passed in here is
 * byte-identical. A *legitimate* same-stage repeat — e.g. the P_score ->
 * needs_retry -> P3 loop — produces a fresh ChatGPT response each time, so
 * its output differs and is correctly inserted as a new row. Exact-string
 * equality is the right boundary: anything that produced different text is,
 * by definition, a genuinely new attempt worth keeping in the audit history.
 */
export async function saveVideoContent(input: {
  videoId: number;
  stage: ContentStage;
  output: string;
  promptVersionId?: number;
}) {
  const [existing] = await db
    .select()
    .from(videoContent)
    .where(
      and(
        eq(videoContent.videoId, input.videoId),
        eq(videoContent.stage, input.stage),
        eq(videoContent.output, input.output),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(videoContent)
    .values({
      videoId: input.videoId,
      stage: input.stage,
      output: input.output,
      promptVersionId: input.promptVersionId,
    })
    .returning();
  return created;
}

/** Latest output for a given (video, stage) — used to build the next stage's prompt vars. */
export async function getLatestVideoContent(videoId: number, stage: ContentStage) {
  const rows = await db
    .select()
    .from(videoContent)
    .where(and(eq(videoContent.videoId, videoId), eq(videoContent.stage, stage)))
    .orderBy(videoContent.createdAt);
  return rows.at(-1) ?? null;
}
