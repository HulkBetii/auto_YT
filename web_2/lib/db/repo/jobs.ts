import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "../index";
import { ahJobs } from "../schema";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}

export async function createAhJob(input: {
  videoId?: number;
  stage: string;
  promptText: string;
  metadata?: unknown;
}) {
  if (input.videoId != null) {
    const existing = await findOpenAhJobForVideoStage(input.videoId, input.stage);
    if (existing) return existing;
  }

  try {
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
  } catch (err) {
    if (input.videoId != null && isUniqueViolation(err)) {
      const existing = await findOpenAhJobForVideoStage(input.videoId, input.stage);
      if (existing) return existing;
    }
    throw err;
  }
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
  // Only match live jobs — failed or fully-consumed jobs must not block a retry.
  const conditions = [
    eq(ahJobs.stage, stage),
    sql`${ahJobs.metadata} ->> 'causedByJobId' = ${String(causeJobId)}`,
    or(
      eq(ahJobs.status, "pending"),
      eq(ahJobs.status, "running"),
      and(eq(ahJobs.status, "done"), isNull(ahJobs.consumedAt)),
    ),
  ];
  if (videoId != null) conditions.push(eq(ahJobs.videoId, videoId));

  const [row] = await db
    .select()
    .from(ahJobs)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

export async function findOpenAhJobForVideoStage(videoId: number, stage: string) {
  const [row] = await db
    .select()
    .from(ahJobs)
    .where(
      and(
        eq(ahJobs.videoId, videoId),
        eq(ahJobs.stage, stage),
        or(
          eq(ahJobs.status, "pending"),
          eq(ahJobs.status, "running"),
          and(eq(ahJobs.status, "done"), isNull(ahJobs.consumedAt)),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function hasOpenAhJobForVideoStage(videoId: number, stage: string) {
  return (await findOpenAhJobForVideoStage(videoId, stage)) != null;
}

export async function markAhJobHandlerFailed(jobId: number, errorMessage: string) {
  await db
    .update(ahJobs)
    .set({
      status: "failed",
      errorMessage,
      consumedAt: null,
      finishedAt: new Date(),
    })
    .where(eq(ahJobs.id, jobId));
}

export async function retryAhJob(jobId: number) {
  const [job] = await db.select().from(ahJobs).where(eq(ahJobs.id, jobId)).limit(1);
  if (!job) return null;
  if (job.status !== "failed") return null;
  const [updated] = await db
    .update(ahJobs)
    .set({ status: "pending", retryCount: 0, errorMessage: null, startedAt: null, finishedAt: null, consumedAt: null })
    .where(eq(ahJobs.id, jobId))
    .returning();
  return updated;
}

export async function listFailedAhJobsByVideo(videoId: number) {
  return db.select().from(ahJobs).where(and(eq(ahJobs.videoId, videoId), eq(ahJobs.status, "failed")));
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
