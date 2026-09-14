import { and, asc, count, desc, eq, isNull, lt, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { koJobs, koSections } from "@/lib/db/schema";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function findOpenKoJob(input: {
  videoId: number;
  kind: string;
  sectionId?: number | null;
  validationAttempt: number;
}) {
  const [row] = await db
    .select()
    .from(koJobs)
    .where(
      and(
        eq(koJobs.videoId, input.videoId),
        eq(koJobs.kind, input.kind),
        input.sectionId == null ? isNull(koJobs.sectionId) : eq(koJobs.sectionId, input.sectionId),
        eq(koJobs.validationAttempt, input.validationAttempt),
        or(
          eq(koJobs.status, "pending"),
          eq(koJobs.status, "running"),
          and(eq(koJobs.status, "done"), isNull(koJobs.consumedAt)),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createKoJob(input: {
  videoId: number;
  sectionId?: number | null;
  kind: "source_audit" | "outline" | "section" | "fidelity_review";
  modelLabel: string;
  effort: string;
  promptText: string;
  promptVersionId: number;
  promptSnapshot: string;
  attachmentPath?: string | null;
  validationAttempt?: number;
  metadata?: unknown;
}) {
  const validationAttempt = input.validationAttempt ?? 0;
  const open = await findOpenKoJob({ ...input, validationAttempt });
  if (open) return open;

  try {
    const [created] = await db
      .insert(koJobs)
      .values({ ...input, validationAttempt })
      .returning();
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await findOpenKoJob({ ...input, validationAttempt });
      if (existing) return existing;
    }
    throw error;
  }
}

export async function listUnconsumedDoneKoJobs() {
  return db
    .select()
    .from(koJobs)
    .where(and(eq(koJobs.status, "done"), isNull(koJobs.consumedAt)))
    .orderBy(asc(koJobs.finishedAt), asc(koJobs.id));
}

export async function listUnconsumedFailedKoJobs() {
  return db
    .select()
    .from(koJobs)
    .where(and(eq(koJobs.status, "failed"), isNull(koJobs.consumedAt)))
    .orderBy(asc(koJobs.finishedAt), asc(koJobs.id));
}

export async function markKoJobConsumed(jobId: number) {
  await db.update(koJobs).set({ consumedAt: new Date() }).where(eq(koJobs.id, jobId));
}

export async function markKoJobHandlerFailed(jobId: number, errorMessage: string) {
  await db
    .update(koJobs)
    .set({
      status: "failed",
      errorMessage: `handler: ${errorMessage}`.slice(0, 4000),
      finishedAt: new Date(),
      consumedAt: null,
    })
    .where(eq(koJobs.id, jobId));
}

export async function getLatestFailedKoJob(videoId: number) {
  const [row] = await db
    .select()
    .from(koJobs)
    .where(
      and(
        eq(koJobs.videoId, videoId),
        eq(koJobs.status, "failed"),
        isNull(koJobs.consumedAt),
      ),
    )
    .orderBy(desc(koJobs.id))
    .limit(1);
  return row ?? null;
}

export async function retryKoJob(jobId: number) {
  const [updated] = await db
    .update(koJobs)
    .set({
      status: "pending",
      retryCount: 0,
      errorMessage: null,
      result: null,
      startedAt: null,
      finishedAt: null,
      consumedAt: null,
    })
    .where(and(eq(koJobs.id, jobId), eq(koJobs.status, "failed")))
    .returning();
  return updated ?? null;
}

export async function resetStaleRunningKoJobs(thresholdMinutes = 20): Promise<number> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);
  const rows = await db
    .update(koJobs)
    .set({
      status: "pending",
      startedAt: null,
      errorMessage: `auto-reset: running longer than ${thresholdMinutes} minutes`,
    })
    .where(and(eq(koJobs.status, "running"), lt(koJobs.startedAt, cutoff)))
    .returning({ id: koJobs.id, sectionId: koJobs.sectionId });
  for (const row of rows) {
    if (row.sectionId) {
      await db
        .update(koSections)
        .set({ status: "pending", updatedAt: new Date() })
        .where(eq(koSections.id, row.sectionId));
    }
  }
  return rows.length;
}

export async function getKoQueueCounts() {
  const rows = await db
    .select({ status: koJobs.status, total: count() })
    .from(koJobs)
    .groupBy(koJobs.status);
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.total)]));
}
