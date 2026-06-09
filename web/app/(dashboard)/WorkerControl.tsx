"use client";

import { useCallback, useEffect, useState } from "react";

const LOCAL_URL = "http://localhost:4242";

type WorkerState = "unknown" | "running" | "stopped" | "offline";

export function WorkerControl() {
  const [state, setState] = useState<WorkerState>("unknown");
  const [busy, setBusy] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${LOCAL_URL}/status`, { signal: AbortSignal.timeout(2000) });
      const data = await res.json();
      setState(data.running ? "running" : "stopped");
    } catch {
      setState("offline");
    }
    setLastChecked(new Date());
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, [poll]);

  async function handleStart() {
    setBusy(true);
    try {
      const res = await fetch(`${LOCAL_URL}/start`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      if (data.ok || data.reason === "already_running") setState("running");
    } catch {
      setState("offline");
    } finally {
      setBusy(false);
      setTimeout(poll, 800);
    }
  }

  async function handleStop() {
    setBusy(true);
    try {
      const res = await fetch(`${LOCAL_URL}/stop`, {
        method: "POST",
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      if (data.ok || data.reason === "not_running") setState("stopped");
    } catch {
      setState("offline");
    } finally {
      setBusy(false);
      setTimeout(poll, 800);
    }
  }

  const dot =
    state === "running"
      ? "bg-[#34C759]"
      : state === "stopped"
        ? "bg-[#FF3B30]"
        : "bg-[#AEAEB2]";

  const label =
    state === "running"
      ? "Worker đang chạy"
      : state === "stopped"
        ? "Worker đã dừng"
        : state === "offline"
          ? "Control server offline"
          : "Đang kiểm tra…";

  return (
    <div className="flex items-center gap-3">
      {/* Status dot + label */}
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${dot} ${state === "running" ? "animate-pulse" : ""}`} />
        <span className="text-[14px] text-[#6E6E73]">{label}</span>
        {lastChecked && (
          <span className="text-[12px] text-[#AEAEB2]">
            · {lastChecked.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
      </div>

      {/* Action buttons */}
      {state === "offline" ? (
        <span className="rounded-lg bg-[#F2F2F7] px-3 py-1.5 text-[13px] text-[#AEAEB2]">
          Chạy: <code className="font-mono">python -m auto_yt.control_server</code>
        </span>
      ) : (
        <>
          {state !== "running" && (
            <button
              onClick={handleStart}
              disabled={busy || state === "unknown"}
              className="rounded-lg bg-[#34C759] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#2DB34A] disabled:opacity-50 transition-colors"
            >
              {busy ? "…" : "Bật Worker"}
            </button>
          )}
          {state === "running" && (
            <button
              onClick={handleStop}
              disabled={busy}
              className="rounded-lg bg-[#FF3B30] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#D70015] disabled:opacity-50 transition-colors"
            >
              {busy ? "…" : "Tắt Worker"}
            </button>
          )}
        </>
      )}

      {/* Refresh */}
      <button
        onClick={poll}
        disabled={busy}
        className="rounded-lg px-2 py-1.5 text-[13px] text-[#AEAEB2] hover:bg-black/[.06] disabled:opacity-50 transition-colors"
        title="Làm mới"
      >
        ↻
      </button>
    </div>
  );
}
