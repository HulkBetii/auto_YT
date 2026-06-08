"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface CycleResult {
  ok: boolean;
  processed: number;
  failedNotified: number;
  results: Array<{ jobId: number; ok: boolean; error?: string }>;
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
 * Shows a short summary of what just got chained (and any per-job errors) so
 * the operator gets the same feedback `curl .../process-jobs` would give,
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
