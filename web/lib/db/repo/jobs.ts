import { and, eq, isNull, sql } from "drizzle-orm";

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

/** Hard-failed jobs the orchestrator hasn't alerted about yet (see notifyNewlyFailedJobs in chain.ts). */
export async function listUnconsumedFailedJobs() {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "failed"), isNull(jobs.consumedAt)));
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

/**
 * Idempotency guard for the chaining engine — see chain.ts `processDoneJob`'s
 * "KNOWN RISK" docstring. `enqueueStage` stamps every job it creates with
 * `metadata.causedByJobId = <id of the job whose handler created it>`. Before
 * inserting, it calls this to check whether that exact (cause job, stage,
 * video) triple already produced a job — which would mean we're re-running a
 * handler that already got as far as enqueueing downstream work (e.g. the
 * cron retried a `processDoneJob` that crashed AFTER `enqueueStage("P_score")`
 * but BEFORE `markJobConsumed`).
 *
 * Keyed on (causeJobId, stage, videoId) rather than just (videoId, stage)
 * like `hasJobForVideoStage` above, because some stages legitimately repeat
 * for the same video across different cause jobs — e.g. the P_score -> P3
 * `needs_retry` loop creates a fresh P3 job each time a score comes back low,
 * each caused by a *different* P_score job id. Keying on the cause job lets
 * us tell "legitimate repeat" (different cause -> allow) apart from
 * "duplicate from a crashed re-run" (same cause -> skip) without touching
 * that retry-loop behavior.
 */
export async function findJobByCause(causeJobId: number, stage: JobStage, videoId?: number) {
  const conditions = [
    eq(jobs.stage, stage),
    sql`${jobs.metadata} ->> 'causedByJobId' = ${String(causeJobId)}`,
  ];
  if (videoId != null) conditions.push(eq(jobs.videoId, videoId));

  const [row] = await db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}
