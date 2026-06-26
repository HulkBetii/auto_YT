"use client";

import { useCallback, useEffect, useState } from "react";

const LOCAL_URL = "http://localhost:4242";

type ProcState = "unknown" | "running" | "stopped" | "offline";

async function callEndpoint(path: string, timeout = 8000): Promise<{ ok: boolean; reason?: string }> {
  const res = await fetch(`${LOCAL_URL}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(timeout),
  });
  return res.json();
}

function StatusDot({ state, label }: { state: ProcState; label: string }) {
  const color =
    state === "running" ? "bg-[#34C759]" :
    state === "stopped" ? "bg-[#FF3B30]" : "bg-[#AEAEB2]";
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color} ${state === "running" ? "animate-pulse" : ""}`} />
      <span className="text-[14px] text-[#6E6E73]">{label}</span>
    </div>
  );
}

export function WorkerControl() {
  const [workerState, setWorkerState] = useState<ProcState>("unknown");
  const [appState, setAppState] = useState<ProcState>("unknown");
  const [busyWorker, setBusyWorker] = useState(false);
  const [busyApp, setBusyApp] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${LOCAL_URL}/status`, { signal: AbortSignal.timeout(2000) });
      const data = await res.json();
      setWorkerState(data.running ? "running" : "stopped");
      setAppState(data.app_running ? "running" : "stopped");
    } catch {
      setWorkerState("offline");
      setAppState("offline");
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
      const data = await callEndpoint(path, workerState === "running" ? 25000 : 5000);
      if (data.ok || data.reason === "already_running") setWorkerState("running");
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

  const isOffline = workerState === "offline";

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {isOffline ? (
        <span className="rounded-lg bg-[#F2F2F7] px-3 py-1.5 text-[13px] text-[#AEAEB2]">
          Control server offline — chạy: <code className="font-mono">python -m auto_yt.control_server</code>
        </span>
      ) : (
        <>
          {/* Worker */}
          <div className="flex items-center gap-2">
            <StatusDot
              state={workerState}
              label={workerState === "running" ? "Worker" : workerState === "stopped" ? "Worker" : "…"}
            />
            <button
              onClick={toggleWorker}
              disabled={busyWorker || workerState === "unknown"}
              className={[
                "rounded-lg px-3 py-1.5 text-[13px] font-medium text-white transition-colors disabled:opacity-50",
                workerState === "running"
                  ? "bg-[#FF3B30] hover:bg-[#D70015]"
                  : "bg-[#34C759] hover:bg-[#2DB34A]",
              ].join(" ")}
            >
              {busyWorker ? "…" : workerState === "running" ? "Tắt" : "Bật"}
            </button>
          </div>

          <span className="text-[#AEAEB2] text-[13px]">·</span>

          {/* Qt App */}
          <div className="flex items-center gap-2">
            <StatusDot
              state={appState}
              label="Auto Login"
            />
            <button
              onClick={toggleApp}
              disabled={busyApp || appState === "unknown"}
              className={[
                "rounded-lg px-3 py-1.5 text-[13px] font-medium text-white transition-colors disabled:opacity-50",
                appState === "running"
                  ? "bg-[#FF3B30] hover:bg-[#D70015]"
                  : "bg-[#007AFF] hover:bg-[#0066CC]",
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
        className="rounded-lg px-2 py-1.5 text-[13px] text-[#AEAEB2] hover:bg-black/[.06] transition-colors"
        title="Làm mới"
      >
        ↻
      </button>
      {lastChecked && (
        <span className="text-[12px] text-[#AEAEB2]">
          {lastChecked.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      )}
    </div>
  );
}
