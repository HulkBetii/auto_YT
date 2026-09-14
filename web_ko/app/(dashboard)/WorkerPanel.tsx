"use client";

import { useCallback, useEffect, useState } from "react";

type SystemStatus = {
  worker: { online: boolean; state: string; error: string | null; profileLocked: boolean };
  queue: Record<string, number>;
  ytProMax: { online: boolean; status: string };
};

type ControlStatus = { available: boolean; running: boolean; pid?: number | null; error?: string };

export function WorkerPanel() {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [control, setControl] = useState<ControlStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [systemResponse, controlResponse] = await Promise.all([
      fetch("/api/system/status", { cache: "no-store" }),
      fetch("/api/worker-control", { cache: "no-store" }),
    ]);
    if (systemResponse.ok) setSystem((await systemResponse.json()) as SystemStatus);
    setControl((await controlResponse.json()) as ControlStatus);
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => load().catch(() => undefined), 0);
    const timer = window.setInterval(() => load().catch(() => undefined), 10_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  async function controlWorker(action: "start" | "stop") {
    setBusy(true);
    await fetch("/api/worker-control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await load();
    setBusy(false);
  }

  async function runCycle() {
    setBusy(true);
    await fetch("/api/pipeline/run", { method: "POST" });
    await load();
    setBusy(false);
  }

  const running = control?.running ?? false;
  const queued = (system?.queue.pending ?? 0) + (system?.queue.running ?? 0);
  return (
    <section className="paper-card reveal p-6 [animation-delay:80ms] md:p-7">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Hệ thống địa phương</p>
          <h2 className="display mt-1 text-2xl font-bold">Nhịp vận hành</h2>
        </div>
        <div className="flex gap-2">
          <button className="button-secondary" disabled={busy} onClick={runCycle}>Chạy một chu kỳ</button>
          <button className={running ? "button-danger" : "button-primary"} disabled={busy || control?.available === false} onClick={() => controlWorker(running ? "stop" : "start")}>{running ? "Dừng worker" : "Khởi động worker"}</button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="KO worker" value={control?.available === false ? "Control offline" : running ? `PID ${control?.pid ?? "?"}` : "Đã dừng"} good={running} />
        <Metric label="Heartbeat" value={system?.worker.profileLocked ? "Profile đang khóa" : system?.worker.online ? system.worker.state : "Offline"} good={!!system?.worker.online && !system.worker.profileLocked} />
        <Metric label="YT_Pro_Max" value={system?.ytProMax.status ?? "Đang kiểm tra"} good={!!system?.ytProMax.online} />
        <Metric label="Queue" value={`${queued} job đang mở`} good={queued === 0} />
      </div>
      {system?.worker.error ? <p className="mt-4 rounded-xl bg-red-900/8 px-4 py-3 text-xs font-bold text-[var(--seal-dark)]">{system.worker.error}</p> : null}
    </section>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <div className="inset-card p-4"><div className="mb-2 flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${good ? "bg-emerald-700" : "bg-[var(--seal)]"}`} /><span className="text-[10px] font-black uppercase tracking-[.12em] text-[var(--ink-soft)]">{label}</span></div><p className="text-sm font-black">{value}</p></div>;
}
