"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface CycleResult {
  ok: boolean;
  processed: number;
  failedNotified: number;
  results: Array<{ jobId: number; ok: boolean; error?: string }>;
  newBatch?: { triggered: boolean; reason?: string; jobId?: number };
  error?: string;
}

/**
 * Manual "advance the pipeline by one tick" button — POSTs to
 * /api/jobs/process-now (see that route's docstring for why this exists:
 * /api/cron/process-jobs is documented as running every minute but is NOT
 * actually registered in vercel.json, so without this button or an external
 * scheduler, completed jobs pile up with consumed_at = NULL and the pipeline
 * visibly stalls after each stage).
 *
 * As of the 2026-06-08 update, one click now does TWO things server-side (see
 * /api/jobs/process-now): (1) chains forward any finished jobs, AND (2) tries
 * to start a brand-new P1 batch (more videos!) if nothing is currently in
 * flight — the same guarded check generate-topics uses, which on this project
 * only runs weekly. So this is a genuine "chạy thêm 1 lượt worker, tạo thêm
 * video" button, not just an unstall button for the current batch.
 *
 * Shows a short summary of what just got chained, any per-job errors, and
 * whether a new batch was started (or why not) — the operator gets the same
 * feedback `curl .../process-jobs` + `curl .../generate-topics` would give,
 * without needing the bearer secret.
 */
export function RunPipelineButton() {
  const router = useRouter();
  const [summary, setSummary] = useState<CycleResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function onClick() {
    setSummary(null);
    startTransition(async () => {
      const res = await fetch("/api/jobs/process-now", { method: "POST" });
      const json = (await res.json().catch(() => null)) as CycleResult | null;
      if (!res.ok || !json) {
        setSummary({ ok: false, processed: 0, failedNotified: 0, results: [], error: json?.error ?? "Chạy pipeline thất bại." });
        return;
      }
      setSummary(json);
      router.refresh();
    });
  }

  const failedJobs = summary?.results.filter((r) => !r.ok) ?? [];

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={onClick}
        disabled={isPending}
        title="Đẩy các job đã xong sang giai đoạn tiếp theo ngay (bù cho việc process-jobs chưa chạy tự động)"
        className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {isPending ? "Đang chạy…" : "▶ Chạy pipeline ngay"}
      </button>
      {summary && (
        <div className="max-w-xs text-right text-xs text-zinc-500 dark:text-zinc-400">
          {summary.error ? (
            <span className="text-red-600">{summary.error}</span>
          ) : (
            <>
              <span>
                Đã xử lý {summary.processed} job
                {summary.failedNotified > 0 ? `, cảnh báo ${summary.failedNotified} job lỗi` : ""}.
              </span>
              {summary.newBatch && (
                <div className="mt-1">
                  {summary.newBatch.triggered ? (
                    <span className="text-emerald-600">
                      ✓ Đã khởi động lô video mới (job #{summary.newBatch.jobId}).
                    </span>
                  ) : (
                    <span>
                      Chưa tạo lô mới — {summary.newBatch.reason === "a batch is already in flight (videos not yet ready_to_publish/published)"
                        ? "lô hiện tại chưa xong."
                        : summary.newBatch.reason === "a job is already pending/running"
                          ? "đang có job đang chạy."
                          : summary.newBatch.reason}
                    </span>
                  )}
                </div>
              )}
              {failedJobs.length > 0 && (
                <ul className="mt-1 text-red-600">
                  {failedJobs.map((r) => (
                    <li key={r.jobId}>
                      Job #{r.jobId}: {r.error}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
