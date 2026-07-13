"use client";
import { useCallback, useEffect, useState } from "react";
const LOCAL_URL = "http://localhost:4242";
const WORKER_HEARTBEAT_STALE_MS = 2 * 60 * 1000;
type ProcState = "unknown" | "running" | "stopped" | "offline";
type WorkerHeartbeat = {
  workerLastSeenAt: string | null;
  workerLastStatus: "running" | "stopped" | null;
};
async function callEndpoint(
  path: string,
  timeout = 8000,
): Promise<{ ok: boolean; reason?: string }> {
  const res = await fetch(`${LOCAL_URL}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(timeout),
  });
  return res.json();
}
function StatusDot({ state, label }: { state: ProcState; label: string }) {
  const color =
    state === "running"
      ? "bg-[var(--success)]"
      : state === "stopped"
        ? "bg-[var(--danger)]"
        : "bg-[var(--text-secondary)]";
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`h-2 w-2 rounded-full ${color} ${state === "running" ? "animate-pulse" : ""}`}
      />
      <span className="text-[14px] text-[var(--text-muted)]">{label}</span>
    </div>
  );
}
export function WorkerControl({ heartbeat }: { heartbeat: WorkerHeartbeat }) {
  const [workerState, setWorkerState] = useState<ProcState>("unknown");
  const [renderState, setRenderState] = useState<ProcState>("unknown");
  const [appState, setAppState] = useState<ProcState>("unknown");
  const [dbHeartbeat, setDbHeartbeat] = useState<WorkerHeartbeat>(heartbeat);
  const [busyWorker, setBusyWorker] = useState(false);
  const [busyRender, setBusyRender] = useState(false);
  const [busyApp, setBusyApp] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${LOCAL_URL}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      const data = await res.json();
      setWorkerState(data.running ? "running" : "stopped");
      setRenderState(data.render_running ? "running" : "stopped");
      setAppState(data.app_running ? "running" : "stopped");
    } catch {
      setWorkerState("offline");
      setRenderState("offline");
      setAppState("offline");
    }
    try {
      const res = await fetch("/api/jobs/worker-heartbeat", {
        cache: "no-store",
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        setDbHeartbeat((await res.json()) as WorkerHeartbeat);
      }
    } catch {
      // Keep the last heartbeat snapshot; the process status is still useful.
    }
    setLastChecked(new Date());
  }, []);
  useEffect(() => {
    const initialId = window.setTimeout(() => {
      void poll();
    }, 0);
    const intervalId = window.setInterval(() => {
      void poll();
    }, 10_000);
    return () => {
      window.clearTimeout(initialId);
      window.clearInterval(intervalId);
    };
  }, [poll]);
  async function toggleWorker() {
    setBusyWorker(true);
    try {
      const path = workerState === "running" ? "/stop" : "/start";
      const data = await callEndpoint(
        path,
        workerState === "running" ? 25000 : 5000,
      );
      if (data.ok || data.reason === "already_running")
        setWorkerState("running");
      if (data.ok || data.reason === "not_running") {
        if (path === "/stop") setWorkerState("stopped");
      }
    } catch {
      setWorkerState("offline");
    } finally {
      setBusyWorker(false);
      setTimeout(poll, 800);
    }
  }
  async function toggleApp() {
    setBusyApp(true);
    try {
      const path = appState === "running" ? "/app/stop" : "/app/start";
      const data = await callEndpoint(path);
      if (data.ok || data.reason === "already_running") setAppState("running");
      if (data.ok && path === "/app/stop") setAppState("stopped");
    } catch {
      setAppState("offline");
    } finally {
      setBusyApp(false);
      setTimeout(poll, 800);
    }
  }
  async function toggleRender() {
    setBusyRender(true);
    try {
      const path = renderState === "running" ? "/render/stop" : "/render/start";
      const data = await callEndpoint(path, path.endsWith("/stop") ? 25000 : 5000);
      if (data.ok || data.reason === "already_running") setRenderState("running");
      if ((data.ok || data.reason === "not_running") && path.endsWith("/stop")) {
        setRenderState("stopped");
      }
    } catch {
      setRenderState("offline");
    } finally {
      setBusyRender(false);
      setTimeout(poll, 800);
    }
  }
  const isOffline = workerState === "offline";
  const heartbeatSeenAt = dbHeartbeat.workerLastSeenAt
    ? new Date(dbHeartbeat.workerLastSeenAt)
    : null;
  const checkedAtMs = lastChecked?.getTime() ?? heartbeatSeenAt?.getTime() ?? 0;
  const heartbeatAgeSeconds = heartbeatSeenAt
    ? Math.max(0, Math.round((checkedAtMs - heartbeatSeenAt.getTime()) / 1000))
    : null;
  const heartbeatFresh =
    dbHeartbeat.workerLastStatus === "running" &&
    heartbeatAgeSeconds !== null &&
    heartbeatAgeSeconds * 1000 <= WORKER_HEARTBEAT_STALE_MS;
  const heartbeatWarning =
    workerState === "running" && !heartbeatFresh
      ? dbHeartbeat.workerLastStatus === "running" && heartbeatAgeSeconds !== null
        ? `DB heartbeat ${heartbeatAgeSeconds}s trước`
        : "DB web chưa thấy worker"
      : null;
  const heartbeatNotice = heartbeatFresh
    ? `DB web running${heartbeatAgeSeconds !== null ? ` ${heartbeatAgeSeconds}s` : ""}`
    : heartbeatWarning;
  const workerButtonDisabled =
    busyWorker ||
    workerState === "unknown" ||
    (heartbeatFresh && workerState !== "running");
  const workerButtonLabel = busyWorker
    ? "…"
    : workerState === "running"
      ? "Tắt"
      : heartbeatFresh
        ? "Đang chạy"
        : "Bật";
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {isOffline ? (
        <span className="rounded-lg bg-[var(--dashboard-bg)] px-3 py-1.5 text-[13px] text-[var(--text-secondary)]">
          Control server offline — chạy:
          <code className="font-mono">python -m auto_yt.control_server</code>
        </span>
      ) : (
        <>
          {/* Worker */}
          <div className="flex items-center gap-2">
            <StatusDot
              state={workerState}
              label={
                workerState === "running"
                  ? "Worker"
                  : workerState === "stopped"
                    ? "Worker"
                    : "…"
              }
            />
            <button
              onClick={toggleWorker}
              disabled={workerButtonDisabled}
              className={[
                "rounded-lg px-3 py-1.5 text-[13px] font-medium text-[var(--dashboard-bg)] transition-colors disabled:opacity-50",
                workerState === "running"
                  ? "bg-[var(--danger)] hover:bg-[var(--danger)]"
                  : "bg-[var(--success)] hover:bg-[var(--success)]",
              ].join(" ")}
            >
              {workerButtonLabel}
            </button>
            {heartbeatNotice && (
              <span
                className={[
                  "rounded-lg px-2 py-1 text-[12px] font-medium",
                  heartbeatFresh
                    ? "bg-[var(--success-soft)] text-[var(--success)]"
                    : "bg-[var(--warning-soft)] text-[var(--warning)]",
                ].join(" ")}
                title={
                  heartbeatFresh
                    ? "DB local web đang nhận heartbeat từ worker."
                    : "Control server có process worker, nhưng DB local web chưa nhận heartbeat mới. Worker có thể đang trỏ sai DATABASE_URL."
                }
              >
                {heartbeatNotice}
              </span>
            )}
          </div>
          <span className="text-[var(--text-secondary)] text-[13px]">·</span>
          <div className="flex items-center gap-2">
            <StatusDot state={renderState} label="Render" />
            <button
              onClick={toggleRender}
              disabled={busyRender || renderState === "unknown"}
              className={[
                "rounded-lg px-3 py-1.5 text-[13px] font-medium text-[var(--dashboard-bg)] transition-colors disabled:opacity-50",
                renderState === "running"
                  ? "bg-[var(--danger)] hover:bg-[var(--danger)]"
                  : "bg-[var(--success)] hover:bg-[var(--success)]",
              ].join(" ")}
            >
              {busyRender ? "…" : renderState === "running" ? "Tắt" : "Bật"}
            </button>
          </div>
          <span className="text-[var(--text-secondary)] text-[13px]">·</span>
          {/* Qt App */}
          <div className="flex items-center gap-2">
            <StatusDot state={appState} label="Auto Login" />
            <button
              onClick={toggleApp}
              disabled={busyApp || appState === "unknown"}
              className={[
                "rounded-lg px-3 py-1.5 text-[13px] font-medium text-[var(--dashboard-bg)] transition-colors disabled:opacity-50",
                appState === "running"
                  ? "bg-[var(--danger)] hover:bg-[var(--danger)]"
                  : "bg-[var(--accent-cyan)] hover:bg-[var(--accent-cyan-hover)]",
              ].join(" ")}
            >
              {busyApp ? "…" : appState === "running" ? "Tắt" : "Bật"}
            </button>
          </div>
        </>
      )}
      {/* Timestamp + refresh */}
      <button
        onClick={poll}
        className="rounded-lg px-2 py-1.5 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] transition-colors"
        title="Làm mới"
      >
        ↻
      </button>
      {lastChecked && (
        <span className="text-[12px] text-[var(--text-secondary)]">
          {lastChecked.toLocaleTimeString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      )}
    </div>
  );
}
