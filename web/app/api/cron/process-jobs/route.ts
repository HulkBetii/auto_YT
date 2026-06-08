import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { markJobConsumed, listUnconsumedDoneJobs } from "@/lib/db/repo/jobs";
import { jobs } from "@/lib/db/schema";
import { logEvent } from "@/lib/observability/log";
import { notify } from "@/lib/notifications";
import { processDoneJob } from "@/lib/pipeline/chain";

export const maxDuration = 300;

/**
 * Hard-failed jobs are terminal — nothing in chain.ts ever consumes them, so
 * `consumed_at` doubles here as "the orchestrator has acknowledged this failure
 * and notified about it," preventing the same job from re-alerting every poll.
 */
async function notifyNewlyFailedJobs() {
  const failed = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "failed"), isNull(jobs.consumedAt)));

  for (const job of failed) {
    await notify(
      `🔴 Job #${job.id} (<b>${job.stage}</b>)${job.videoId ? ` for video #${job.videoId}` : ""} failed: ${job.errorMessage ?? "unknown error"}`,
    );
    await markJobConsumed(job.id);
    logEvent("job_failed_notified", { jobId: job.id, videoId: job.videoId, stage: job.stage });
  }

  return failed.length;
}

/**
 * Polled by Vercel Cron (see vercel.json) — there is no long-lived orchestrator
 * process. Each run picks up jobs the worker finished since the last pass and
 * chains the pipeline forward (see lib/pipeline/chain.ts for the state machine),
 * plus notifies about any newly hard-failed jobs.
 */
export async function GET(request: Request) {
  const expected = process.env.DASHBOARD_SECRET;
  if (expected) {
    const provided = request.headers.get("authorization");
    if (provided !== `Bearer ${expected}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const pendingJobs = await listUnconsumedDoneJobs();
  const results: Array<{ jobId: number; ok: boolean; error?: string }> = [];

  for (const job of pendingJobs) {
    try {
      await processDoneJob(job.id);
      results.push({ jobId: job.id, ok: true });
    } catch (error) {
      results.push({
        jobId: job.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failedNotified = await notifyNewlyFailedJobs();

  return NextResponse.json({ ok: true, processed: results.length, results, failedNotified });
}
