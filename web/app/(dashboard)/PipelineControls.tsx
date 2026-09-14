"use client";

import { Layers3, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  classifyTtsCycleResult,
  type TtsCycleState,
} from "@/lib/ui/operations";

type WorkerSnapshot = {
  healthy: boolean;
  status: "running" | "stopped" | null;
  lastSeenAt: string | null;
  ageSeconds: number | null;
};

type CycleResult = {
  ok: boolean;
  processed: number;
  failedNotified: number;
  results: Array<{ jobId: number; ok: boolean; error?: string }>;
  tts: {
    processed: number;
    results: Array<{
      videoId: number;
      ok: boolean;
      audioUrl?: string;
      error?: string;
    }>;
  };
  p5Triggered: number[];
  p6Batch: number[] | null;
  worker: WorkerSnapshot;
  error?: string;
};

type BatchResult = {
  ok: boolean;
  triggered: boolean;
  jobId?: number;
  reason?: string;
  worker: WorkerSnapshot;
  error?: string;
};

function describeBatchBlock(reason?: string) {
  if (reason?.includes("new_batch_paused")) {
    return "Đang tạm dừng tạo lô mới trong Cài đặt.";
  }
  if (reason?.includes("videos not yet")) {
    return "Một lô video cũ vẫn đang được xử lý.";
  }
  if (reason?.includes("pending/running")) {
    return "Vẫn còn job pending hoặc running.";
  }
  return reason ?? "Chưa thể tạo lô mới.";
}

function WorkerWarning({ worker }: { worker: WorkerSnapshot | null }) {
  if (!worker || worker.healthy) return null;
  const message =
    worker.status === "running" && worker.lastSeenAt
      ? `Worker chưa heartbeat vào DB web trong ${worker.ageSeconds ?? "?"} giây.`
      : "Worker Playwright chưa xác nhận đang chạy trên DB web.";
  return <p className="text-[12px] text-[var(--warning)]">{message}</p>;
}

export function PipelineControls({
  newBatchPaused,
  initialWorker,
}: {
  newBatchPaused: boolean;
  initialWorker: WorkerSnapshot;
}) {
  const router = useRouter();
  const [cycleResult, setCycleResult] = useState<CycleResult | null>(null);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [confirmingBatch, setConfirmingBatch] = useState(false);
  const [busyAction, setBusyAction] = useState<"continue" | "batch" | null>(
    null,
  );

  async function continuePipeline() {
    setCycleResult(null);
    setBusyAction("continue");
    try {
      const response = await fetch("/api/jobs/process-now", { method: "POST" });
      const result = (await response.json().catch(() => null)) as CycleResult | null;
      if (!response.ok || !result) {
        setCycleResult({
          ok: false,
          processed: 0,
          failedNotified: 0,
          results: [],
          tts: { processed: 0, results: [] },
          p5Triggered: [],
          p6Batch: null,
          worker: initialWorker,
          error: result?.error ?? "Tiếp tục pipeline thất bại.",
        });
        return;
      }
      setCycleResult(result);
      router.refresh();
    } catch {
      setCycleResult({
        ok: false,
        processed: 0,
        failedNotified: 0,
        results: [],
        tts: { processed: 0, results: [] },
        p5Triggered: [],
        p6Batch: null,
        worker: initialWorker,
        error: "Không thể kết nối tới server.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function startBatch() {
    setConfirmingBatch(false);
    setBatchResult(null);
    setBusyAction("batch");
    try {
      const response = await fetch("/api/jobs/start-batch", { method: "POST" });
      const result = (await response.json().catch(() => null)) as BatchResult | null;
      if (!result) {
        setBatchResult({
          ok: false,
          triggered: false,
          worker: initialWorker,
          error: "Không nhận được phản hồi từ server.",
        });
        return;
      }
      setBatchResult(result);
      if (response.ok) router.refresh();
    } catch {
      setBatchResult({
        ok: false,
        triggered: false,
        worker: initialWorker,
        error: "Không thể kết nối tới server.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  const failedJobs = cycleResult?.results.filter((result) => !result.ok) ?? [];
  const ttsCounts = (cycleResult?.tts.results ?? []).reduce(
    (counts, result) => {
      const state = classifyTtsCycleResult(result);
      counts[state] += 1;
      return counts;
    },
    {
      completed: 0,
      submitted: 0,
      running: 0,
      blocked: 0,
      retrying: 0,
      failed: 0,
    } satisfies Record<TtsCycleState, number>,
  );

  return (
    <div className="flex max-w-full flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          onClick={() => void continuePipeline()}
          disabled={busyAction !== null}
          size="sm"
          className="gap-1.5 bg-[var(--accent-cyan)] text-[var(--dashboard-bg)] hover:bg-[var(--accent-cyan-hover)]"
        >
          <Play className="h-3.5 w-3.5" />
          {busyAction === "continue" ? "Đang xử lý…" : "Tiếp tục pipeline"}
        </Button>
        <Button
          onClick={() => {
            if (confirmingBatch) {
              void startBatch();
            } else {
              setBatchResult(null);
              setConfirmingBatch(true);
            }
          }}
          disabled={busyAction !== null || newBatchPaused}
          size="sm"
          variant="outline"
          title={
            newBatchPaused
              ? "Bật lại tạo lô mới trong Cài đặt trước khi sử dụng."
              : "Tạo một job P1 mới sau khi xác nhận."
          }
          className={[
            "gap-1.5 border-[var(--border-subtle)] text-[var(--text-primary)]",
            confirmingBatch
              ? "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]"
              : "",
          ].join(" ")}
        >
          <Layers3 className="h-3.5 w-3.5" />
          {busyAction === "batch"
            ? "Đang tạo…"
            : confirmingBatch
              ? "Xác nhận tạo lô"
              : "Tạo lô mới"}
        </Button>
        {confirmingBatch && (
          <Button
            onClick={() => setConfirmingBatch(false)}
            disabled={busyAction !== null}
            size="sm"
            variant="ghost"
            className="text-[var(--text-muted)]"
          >
            Hủy
          </Button>
        )}
      </div>
      {confirmingBatch && (
        <p className="text-right text-[12px] text-[var(--warning)]">
          Nhấn xác nhận để tạo một job P1 mới qua worker Playwright.
        </p>
      )}
      {newBatchPaused && (
        <p className="text-right text-[12px] text-[var(--text-muted)]">
          Tạo lô mới đang tạm dừng trong Cài đặt.
        </p>
      )}
      {cycleResult && (
        <div className="max-w-lg text-right text-[12px] text-[var(--text-muted)]">
          {cycleResult.error ? (
            <p className="text-[var(--danger)]">{cycleResult.error}</p>
          ) : (
            <>
              <p>
                Đã consume {cycleResult.processed} job. Audio hoàn tất: {cycleResult.tts.processed}.
                {cycleResult.failedNotified > 0
                  ? ` Đã gửi ${cycleResult.failedNotified} cảnh báo lỗi.`
                  : ""}
              </p>
              {(ttsCounts.submitted > 0 ||
                ttsCounts.running > 0 ||
                ttsCounts.blocked > 0 ||
                ttsCounts.retrying > 0 ||
                ttsCounts.failed > 0) && (
                <p>
                  TTS: {ttsCounts.submitted} đã gửi, {ttsCounts.running} đang chạy,
                  {" "}{ttsCounts.blocked} thiếu voice, {ttsCounts.retrying} chờ gửi lại,
                  {" "}{ttsCounts.failed} lỗi.
                </p>
              )}
              <p className={cycleResult.p5Triggered.length > 0 ? "text-[var(--success)]" : undefined}>
                {cycleResult.p5Triggered.length > 0
                  ? `P5: đã enqueue video #${cycleResult.p5Triggered.join(", #")}.`
                  : "P5: không có video đủ điều kiện."}
              </p>
              <p className={cycleResult.p6Batch ? "text-[var(--success)]" : undefined}>
                {cycleResult.p6Batch
                  ? `P6: đã enqueue batch #${cycleResult.p6Batch.join(", #")}.`
                  : "P6: chưa đủ batch analytics."}
              </p>
              {failedJobs.map((result) => (
                <p key={result.jobId} className="text-[var(--danger)]">
                  Job #{result.jobId}: {result.error ?? "Không rõ lỗi"}
                </p>
              ))}
              <WorkerWarning worker={cycleResult.worker} />
            </>
          )}
        </div>
      )}
      {batchResult && (
        <div className="max-w-lg text-right text-[12px] text-[var(--text-muted)]">
          {batchResult.triggered ? (
            <p className="text-[var(--success)]">
              Đã tạo lô mới, job P1 #{batchResult.jobId}.
            </p>
          ) : (
            <p className="text-[var(--warning)]">
              {batchResult.error ?? describeBatchBlock(batchResult.reason)}
            </p>
          )}
          <WorkerWarning worker={batchResult.worker} />
        </div>
      )}
    </div>
  );
}
