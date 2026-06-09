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
  tts?: { processed: number; results: Array<{ videoId: number; ok: boolean; audioUrl?: string; error?: string }> };
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
        setSummary({ ok: false, processed: 0, failedNotified: 0, results: [], error: json?.error ?? "Chạy pipeline thất bại." });
        return;
      }
      setSummary(json);
      router.refresh();
    } catch {
      setSummary({ ok: false, processed: 0, failedNotified: 0, results: [], error: "Không thể kết nối tới server." });
    } finally {
      setIsLoading(false);
    }
  }

  const failedJobs = summary?.results.filter((r) => !r.ok) ?? [];
  const ttsErrors = summary?.tts?.results.filter((r) => !r.ok) ?? [];

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        onClick={onClick}
        disabled={isLoading}
        size="sm"
        className="gap-1.5 bg-[#007AFF] text-white hover:bg-[#0062CC] disabled:opacity-50"
      >
        <Play className="h-3.5 w-3.5" />
        {isLoading ? "Đang chạy…" : "Chạy pipeline"}
      </Button>

      {summary && (
        <div className="max-w-xs text-right text-[13px] text-[#6E6E73]">
          {summary.error ? (
            <span className="text-[#FF3B30]">{summary.error}</span>
          ) : (
            <>
              <span>
                Đã xử lý {summary.processed} job
                {summary.failedNotified > 0 ? `, cảnh báo ${summary.failedNotified} lỗi` : ""}.
              </span>
              {summary.newBatch?.triggered && (
                <div className="mt-1 text-[#34C759]">
                  Đã khởi động lô mới (job #{summary.newBatch.jobId}).
                </div>
              )}
              {(summary.tts?.processed ?? 0) > 0 && (
                <div className="mt-1 text-[#34C759]">
                  Đã tạo {summary.tts!.processed} audio TTS.
                </div>
              )}
              {ttsErrors.length > 0 && (
                <ul className="mt-1 text-[#FF3B30]">
                  {ttsErrors.map((r) => (
                    <li key={r.videoId}>TTS #{r.videoId}: {r.error}</li>
                  ))}
                </ul>
              )}
              {failedJobs.length > 0 && (
                <ul className="mt-1 text-[#FF3B30]">
                  {failedJobs.map((r) => (
                    <li key={r.jobId}>Job #{r.jobId}: {r.error}</li>
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
