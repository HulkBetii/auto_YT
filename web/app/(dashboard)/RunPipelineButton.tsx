"use client";
import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
interface CycleResult {
  ok: boolean;
  processed: number;
  failedNotified: number;
  results: Array<{ jobId: number; ok: boolean; error?: string }>;
  newBatch?: { triggered: boolean; reason?: string; jobId?: number };
  tts?: {
    processed: number;
    results: Array<{
      videoId: number;
      ok: boolean;
      audioUrl?: string;
      error?: string;
    }>;
  };
  worker?: {
    healthy: boolean;
    status: "running" | "stopped" | null;
    lastSeenAt: string | null;
    ageSeconds: number | null;
  };
  error?: string;
}
export function RunPipelineButton() {
  const router = useRouter();
  const [summary, setSummary] = useState<CycleResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  async function onClick() {
    setSummary(null);
    setIsLoading(true);
    try {
      const res = await fetch("/api/jobs/process-now", { method: "POST" });
      const json = (await res.json().catch(() => null)) as CycleResult | null;
      if (!res.ok || !json) {
        setSummary({
          ok: false,
          processed: 0,
          failedNotified: 0,
          results: [],
          error: json?.error ?? "Chạy pipeline thất bại.",
        });
        return;
      }
      setSummary(json);
      router.refresh();
    } catch {
      setSummary({
        ok: false,
        processed: 0,
        failedNotified: 0,
        results: [],
        error: "Không thể kết nối tới server.",
      });
    } finally {
      setIsLoading(false);
    }
  }
  const failedJobs = summary?.results.filter((r) => !r.ok) ?? [];
  const ttsErrors = summary?.tts?.results.filter((r) => !r.ok) ?? [];
  const workerWarning =
    summary &&
    !summary.error &&
    summary.worker &&
    !summary.worker.healthy
      ? summary.worker.status === "running" && summary.worker.lastSeenAt
        ? `Worker chưa heartbeat vào DB web trong ${summary.worker.ageSeconds ?? "?"}s. Job mới có thể đang chờ worker local đúng môi trường.`
        : "Worker local chưa xác nhận chạy trong DB web. Job mới sẽ nằm pending cho tới khi bật worker đúng môi trường."
      : null;
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        onClick={onClick}
        disabled={isLoading}
        size="sm"
        className="gap-1.5 bg-[var(--accent-cyan)] text-[var(--dashboard-bg)] hover:bg-[var(--accent-cyan-hover)] disabled:opacity-50"
      >
        <Play className="h-3.5 w-3.5" />
        {isLoading ? "Đang chạy…" : "Chạy pipeline"}
      </Button>
      {summary && (
        <div className="max-w-xs text-right text-[13px] text-[var(--text-muted)]">
          {summary.error ? (
            <span className="text-[var(--danger)]">{summary.error}</span>
          ) : (
            <>
              <span>
                Đã xử lý {summary.processed} job
                {summary.failedNotified > 0
                  ? `, cảnh báo ${summary.failedNotified} lỗi`
                  : ""}
                .
              </span>
              {summary.newBatch?.triggered && (
                <div className="mt-1 text-[var(--success)]">
                  Đã khởi động lô mới (job #{summary.newBatch.jobId}).
                </div>
              )}
              {workerWarning && (
                <div className="mt-1 text-[var(--warning)]">
                  {workerWarning}
                </div>
              )}
              {(summary.tts?.processed ?? 0) > 0 && (
                <div className="mt-1 text-[var(--success)]">
                  Đã tạo {summary.tts!.processed} audio TTS.
                </div>
              )}
              {ttsErrors.length > 0 && (
                <ul className="mt-1 text-[var(--danger)]">
                  {ttsErrors.map((r) => (
                    <li key={r.videoId}>
                      TTS #{r.videoId}: {r.error}
                    </li>
                  ))}
                </ul>
              )}
              {failedJobs.length > 0 && (
                <ul className="mt-1 text-[var(--danger)]">
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
