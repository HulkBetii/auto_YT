import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "../index";
import { drJobs } from "../schema";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}

export async function createDrJob(input: {
  episodeId?: number;
  stage: string;
  promptText: string;
  metadata?: unknown;
}) {
  if (input.episodeId != null) {
    const existing = await findOpenDrJobForEpisodeStage(input.episodeId, input.stage);
    if (existing) return existing;
  }

  try {
    const [created] = await db
      .insert(drJobs)
      .values({
        episodeId: input.episodeId,
        stage: input.stage,
        promptText: input.promptText,
        metadata: input.metadata,
      })
      .returning();
    return created;
  } catch (err) {
    if (input.episodeId != null && isUniqueViolation(err)) {
      const existing = await findOpenDrJobForEpisodeStage(input.episodeId, input.stage);
      if (existing) return existing;
    }
    throw err;
  }
}

export async function listUnconsumedDoneDrJobs() {
  return db
    .select()
    .from(drJobs)
    .where(and(eq(drJobs.status, "done"), isNull(drJobs.consumedAt)));
}

export async function listUnconsumedFailedDrJobs() {
  return db
    .select()
    .from(drJobs)
    .where(and(eq(drJobs.status, "failed"), isNull(drJobs.consumedAt)));
}

export async function markDrJobConsumed(jobId: number) {
  await db.update(drJobs).set({ consumedAt: new Date() }).where(eq(drJobs.id, jobId));
}

export async function getDrJob(jobId: number) {
  const [row] = await db.select().from(drJobs).where(eq(drJobs.id, jobId)).limit(1);
  return row ?? null;
}

export async function listDrJobsByEpisode(episodeId: number) {
  return db
    .select()
    .from(drJobs)
    .where(eq(drJobs.episodeId, episodeId))
    .orderBy(drJobs.createdAt);
}

/**
 * Idempotency guard. enqueueDrStage stamps metadata.causedByJobId; this prevents
 * double-enqueue when a cron retries a handler that crashed after enqueueing but
 * before consume.
 */
export async function findDrJobByCause(
  causeJobId: number,
  stage: string,
  episodeId?: number,
) {
  const conditions = [
    eq(drJobs.stage, stage),
    sql`${drJobs.metadata} ->> 'causedByJobId' = ${String(causeJobId)}`,
    or(
      eq(drJobs.status, "pending"),
      eq(drJobs.status, "running"),
      and(eq(drJobs.status, "done"), isNull(drJobs.consumedAt)),
    ),
  ];
  if (episodeId != null) conditions.push(eq(drJobs.episodeId, episodeId));

  const [row] = await db
    .select()
    .from(drJobs)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

export async function findOpenDrJobForEpisodeStage(episodeId: number, stage: string) {
  const [row] = await db
    .select()
    .from(drJobs)
    .where(
      and(
        eq(drJobs.episodeId, episodeId),
        eq(drJobs.stage, stage),
        or(
          eq(drJobs.status, "pending"),
          eq(drJobs.status, "running"),
          and(eq(drJobs.status, "done"), isNull(drJobs.consumedAt)),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function hasOpenDrJobForEpisodeStage(episodeId: number, stage: string) {
  return (await findOpenDrJobForEpisodeStage(episodeId, stage)) != null;
}

export async function markDrJobHandlerFailed(jobId: number, errorMessage: string) {
  await db
    .update(drJobs)
    .set({
      status: "failed",
      errorMessage,
      consumedAt: null,
      finishedAt: new Date(),
    })
    .where(eq(drJobs.id, jobId));
}

export async function retryDrJob(jobId: number) {
  const [job] = await db.select().from(drJobs).where(eq(drJobs.id, jobId)).limit(1);
  if (!job) return null;
  if (job.status !== "failed") return null;
  const [updated] = await db
    .update(drJobs)
    .set({ status: "pending", retryCount: 0, errorMessage: null, startedAt: null, finishedAt: null, consumedAt: null })
    .where(eq(drJobs.id, jobId))
    .returning();
  return updated;
}

export async function listFailedDrJobsByEpisode(episodeId: number) {
  return db.select().from(drJobs).where(and(eq(drJobs.episodeId, episodeId), eq(drJobs.status, "failed")));
}

export async function resetStaleRunningDrJobs(thresholdMinutes = 15): Promise<number> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);
  const reset = await db
    .update(drJobs)
    .set({
      status: "pending",
      startedAt: null,
      errorMessage: `auto-reset: stuck in running > ${thresholdMinutes}min`,
    })
    .where(and(eq(drJobs.status, "running"), lt(drJobs.startedAt, cutoff)))
    .returning({ id: drJobs.id });
  return reset.length;
}
