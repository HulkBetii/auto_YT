import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";

/**
 * Resets a hard-failed job back to pending so the worker picks it up again.
 *
 * Bug fixed 2026-06-08 (caught during a code-review pass, not live — the
 * specific timing needed to trigger it didn't occur during e2e testing):
 * `consumed_at` doubles as "orchestrator has acknowledged this job" for BOTH
 * terminal meanings — "chained forward" for `done` jobs and "alerted about"
 * for `failed` ones (see process-jobs/route.ts). If a hard-failed job had
 * already been through `notifyNewlyFailedJobs` (which stamps `consumed_at`
 * when it sends the Telegram alert) before being retried here, the old
 * timestamp survived the reset. The job would then complete successfully as
 * `done` with a STALE non-null `consumed_at` — and `processDoneJob`'s guard
 * (`if (... || job.consumedAt) return`) would skip it forever, silently
 * stranding it mid-pipeline with no next-stage job ever created. Clearing it
 * here lets a freshly-retried job be chained forward exactly like a normal
 * first-time completion.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number.parseInt(id, 10);
  if (!Number.isFinite(jobId)) return NextResponse.json({ ok: false, error: "ID job không hợp lệ" }, { status: 400 });

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return NextResponse.json({ ok: false, error: "Không tìm thấy job" }, { status: 404 });
  if (job.status !== "failed") {
    return NextResponse.json({ ok: false, error: "Chỉ có thể thử lại các job đã thất bại từ đây" }, { status: 400 });
  }

  await db
    .update(jobs)
    .set({ status: "pending", retryCount: 0, errorMessage: null, startedAt: null, finishedAt: null, consumedAt: null })
    .where(eq(jobs.id, jobId));

  return NextResponse.json({ ok: true });
}
