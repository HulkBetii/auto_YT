import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "../index";
import { ahJobs } from "../schema";

export async function createAhJob(input: {
  videoId?: number;
  stage: string;
  promptText: string;
  metadata?: unknown;
}) {
  const [created] = await db
    .insert(ahJobs)
    .values({
      videoId: input.videoId,
      stage: input.stage,
      promptText: input.promptText,
      metadata: input.metadata,
    })
    .returning();
  return created;
}

export async function listUnconsumedDoneAhJobs() {
  return db
    .select()
    .from(ahJobs)
    .where(and(eq(ahJobs.status, "done"), isNull(ahJobs.consumedAt)));
}

export async function listUnconsumedFailedAhJobs() {
  return db
    .select()
    .from(ahJobs)
    .where(and(eq(ahJobs.status, "failed"), isNull(ahJobs.consumedAt)));
}

export async function markAhJobConsumed(jobId: number) {
  await db.update(ahJobs).set({ consumedAt: new Date() }).where(eq(ahJobs.id, jobId));
}

export async function getAhJob(jobId: number) {
  const [row] = await db.select().from(ahJobs).where(eq(ahJobs.id, jobId)).limit(1);
  return row ?? null;
}

export async function listAhJobsByVideo(videoId: number) {
  return db
    .select()
    .from(ahJobs)
    .where(eq(ahJobs.videoId, videoId))
    .orderBy(ahJobs.createdAt);
}

/**
 * Idempotency guard — same pattern as web/lib/db/repo/jobs.ts:findJobByCause.
 * enqueueAhStage stamps metadata.causedByJobId; this prevents double-enqueue
 * when a cron retries a handler that crashed after enqueueing but before consume.
 */
export async function findAhJobByCause(
  causeJobId: number,
  stage: string,
  videoId?: number,
) {
  const conditions = [
    eq(ahJobs.stage, stage),
    sql`${ahJobs.metadata} ->> 'causedByJobId' = ${String(causeJobId)}`,
  ];
  if (videoId != null) conditions.push(eq(ahJobs.videoId, videoId));

  const [row] = await db
    .select()
    .from(ahJobs)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

export async function resetStaleRunningAhJobs(thresholdMinutes = 15): Promise<number> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);
  const reset = await db
    .update(ahJobs)
    .set({
      status: "pending",
      startedAt: null,
      errorMessage: `auto-reset: stuck in running > ${thresholdMinutes}min`,
    })
    .where(and(eq(ahJobs.status, "running"), lt(ahJobs.startedAt, cutoff)))
    .returning({ id: ahJobs.id });
  return reset.length;
}
