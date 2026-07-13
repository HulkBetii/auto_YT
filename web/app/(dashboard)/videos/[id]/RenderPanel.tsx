"use client";

import { Captions, Download, Film, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { RenderStatusBadge } from "@/components/RenderStatusBadge";
import { formatDateTime } from "@/lib/ui/format";
import { MAX_RENDER_ATTEMPTS } from "@/lib/render/state";

type RenderSnapshot = {
  audioUrl: string | null;
  renderStatus: string;
  renderError: string | null;
  renderAttemptCount: number;
  renderNextAttemptAt: string | Date | null;
  renderRequestedAt: string | Date | null;
  renderStartedAt: string | Date | null;
  renderFinishedAt: string | Date | null;
  renderHeartbeatAt: string | Date | null;
  outputAvailable: boolean;
  subtitleAvailable: boolean;
  outputCurrent: boolean;
  waitingForAudio?: boolean;
  missingTtsText?: boolean;
};

export function RenderPanel({
  videoId,
  initialSnapshot,
}: {
  videoId: number;
  initialSnapshot: RenderSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/videos/${videoId}/render/status`, {
      cache: "no-store",
    });
    if (response.ok) {
      setSnapshot((await response.json()) as RenderSnapshot);
    }
  }, [videoId]);

  useEffect(() => {
    const shouldPoll =
      snapshot.renderStatus === "not_started" ||
      snapshot.renderStatus === "rendering" ||
      (snapshot.renderStatus === "failed" &&
        snapshot.renderAttemptCount < MAX_RENDER_ATTEMPTS &&
        snapshot.renderNextAttemptAt);
    if (!shouldPoll) return;
    const intervalId = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(intervalId);
  }, [
    refresh,
    snapshot.renderAttemptCount,
    snapshot.renderNextAttemptAt,
    snapshot.renderStatus,
  ]);

  async function queue(action: "retry" | "rerender") {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/videos/${videoId}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(result?.error ?? "Không thể đưa video vào hàng render.");
        return;
      }
      setMessage(action === "retry" ? "Đã đưa lại vào hàng chờ." : "Đã yêu cầu render lại.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const retryScheduled =
    snapshot.renderStatus === "failed" &&
    snapshot.renderAttemptCount < MAX_RENDER_ATTEMPTS &&
    snapshot.renderNextAttemptAt;
  const canRetry = snapshot.renderStatus === "failed";

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase text-[var(--text-secondary)]">
          VIDEO RENDER
        </p>
        <RenderStatusBadge
          audioUrl={snapshot.audioUrl}
          renderStatus={snapshot.renderStatus}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]">
        {snapshot.outputAvailable ? (
          <video
            key={`${videoId}-${snapshot.renderFinishedAt ?? "previous"}`}
            controls
            preload="metadata"
            src={`/api/videos/${videoId}/render/file`}
            className="aspect-video w-full bg-black"
          />
        ) : (
          <div className="flex aspect-video items-center justify-center bg-[var(--dashboard-bg)] text-[var(--text-secondary)]">
            <Film className="h-8 w-8" />
          </div>
        )}

        <div className="flex flex-col gap-3 p-4">
          {!snapshot.outputCurrent && snapshot.outputAvailable && (
            <p className="text-[13px] text-[var(--warning)]">
              Đang giữ bản render thành công trước đó cho tới khi bản mới hoàn tất.
            </p>
          )}
          {snapshot.renderError && (
            <p className="rounded-md bg-[var(--danger-soft)] px-3 py-2 text-[13px] text-[var(--danger)]">
              {snapshot.renderError}
            </p>
          )}
          {snapshot.missingTtsText && (
            <p className="text-[13px] text-[var(--danger)]">
              Thiếu text TTS. Cần chạy backfill trước khi render.
            </p>
          )}
          {retryScheduled && (
            <p className="text-[13px] text-[var(--warning)]">
              Retry tự động lúc {formatDateTime(new Date(snapshot.renderNextAttemptAt!))}.
            </p>
          )}

          <div className="grid gap-2 text-[13px] text-[var(--text-muted)] sm:grid-cols-5">
            <span>Attempt: {snapshot.renderAttemptCount} / {MAX_RENDER_ATTEMPTS}</span>
            <span>
              Yêu cầu:{" "}
              {snapshot.renderRequestedAt
                ? formatDateTime(new Date(snapshot.renderRequestedAt))
                : "—"}
            </span>
            <span>
              Bắt đầu:{" "}
              {snapshot.renderStartedAt
                ? formatDateTime(new Date(snapshot.renderStartedAt))
                : "—"}
            </span>
            <span>
              Hoàn tất:{" "}
              {snapshot.renderFinishedAt
                ? formatDateTime(new Date(snapshot.renderFinishedAt))
                : "—"}
            </span>
            <span>
              Heartbeat:{" "}
              {snapshot.renderHeartbeatAt
                ? formatDateTime(new Date(snapshot.renderHeartbeatAt))
                : "—"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {snapshot.outputAvailable && (
              <a
                href={`/api/videos/${videoId}/render/file?download=1`}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
              >
                <Download className="h-4 w-4" />
                Tải video
              </a>
            )}
            {snapshot.subtitleAvailable && (
              <a
                href={`/api/videos/${videoId}/render/subtitles`}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
              >
                <Captions className="h-4 w-4" />
                Tải SRT
              </a>
            )}
            {canRetry && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void queue("retry")}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent-cyan)] px-3 text-[13px] font-medium text-[var(--dashboard-bg)] disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            )}
            {snapshot.audioUrl &&
              !snapshot.missingTtsText &&
              snapshot.renderStatus !== "rendering" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void queue("rerender")}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Render lại
                </button>
              )}
          </div>
          {message && (
            <p className="text-[13px] text-[var(--text-secondary)]">{message}</p>
          )}
        </div>
      </div>
    </section>
  );
}
