"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface CycleResult {
  ok: boolean;
  processed: number;
  ttsRan: boolean;
  staleReset: number;
  results: Array<{ jobId: number; stage: string; ok: boolean; error?: string }>;
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
        setSummary({ ok: false, processed: 0, ttsRan: false, staleReset: 0, results: [], error: json?.error ?? "Pipeline run failed." });
        return;
      }
      setSummary(json);
      router.refresh();
    } catch {
      setSummary({ ok: false, processed: 0, ttsRan: false, staleReset: 0, results: [], error: "Cannot connect to server." });
    } finally {
      setIsLoading(false);
    }
  }

  const failedJobs = summary?.results.filter((r) => !r.ok) ?? [];

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        onClick={onClick}
        disabled={isLoading}
        size="sm"
        className="gap-1.5 bg-[#007AFF] text-white hover:bg-[#0062CC] disabled:opacity-50"
      >
        <Play className="h-3.5 w-3.5" />
        {isLoading ? "Running…" : "Run pipeline"}
      </Button>

      {summary && (
        <div className="max-w-xs text-right text-[13px] text-[#6E6E73]">
          {summary.error ? (
            <span className="text-[#FF3B30]">{summary.error}</span>
          ) : (
            <>
              <span>
                Processed {summary.processed} job{summary.processed !== 1 ? "s" : ""}
                {summary.ttsRan ? " · TTS ran" : ""}
                {summary.staleReset > 0 ? ` · reset ${summary.staleReset} stale` : ""}.
              </span>
              {failedJobs.length > 0 && (
                <ul className="mt-1 text-[#FF3B30]">
                  {failedJobs.map((r) => (
                    <li key={r.jobId}>Job #{r.jobId} ({r.stage}): {r.error}</li>
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
