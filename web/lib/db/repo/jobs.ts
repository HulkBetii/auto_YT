import { and, eq, isNull } from "drizzle-orm";

import { db } from "../index";
import { jobs, type jobStageEnum } from "../schema";

type JobStage = (typeof jobStageEnum.enumValues)[number];

/**
 * Creates a job with a fully pre-interpolated `prompt_text` snapshot — see jobs.ts comment.
 * The Python worker only reads/writes this table; it never resolves prompt_versions itself.
 */
export async function createJob(input: {
  videoId?: number;
  stage: JobStage;
  promptText: string;
  promptVersionId: number;
  metadata?: unknown;
}) {
  const [created] = await db
    .insert(jobs)
    .values({
      videoId: input.videoId,
      stage: input.stage,
      promptText: input.promptText,
      promptVersionId: input.promptVersionId,
      metadata: input.metadata,
    })
    .returning();
  return created;
}

/** Jobs the worker has finished but the orchestrator hasn't chained onward yet. */
export async function listUnconsumedDoneJobs() {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "done"), isNull(jobs.consumedAt)));
}

export async function markJobConsumed(jobId: number) {
  await db.update(jobs).set({ consumedAt: new Date() }).where(eq(jobs.id, jobId));
}

export async function getJob(jobId: number) {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return row ?? null;
}

/** Guards against re-enqueuing the same analysis stage for a video on every cron tick. */
export async function hasJobForVideoStage(videoId: number, stage: JobStage) {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.videoId, videoId), eq(jobs.stage, stage)))
    .limit(1);
  return row != null;
}
