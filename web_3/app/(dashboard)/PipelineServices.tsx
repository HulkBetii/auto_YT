"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
interface StatusData {
  worker: {
    online: boolean;
    paused: boolean;
    lastSeen: string | null;
    ageMs: number | null;
  };
  cron: { active: boolean; lastRun: string | null; ageMs: number | null };
  pipeline: { paused: boolean };
}
function fmtAge(ms: number | null): string {
  if (ms === null) return "never";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
function Dot({ on, pulse }: { on: boolean; pulse?: boolean }) {
  return (
    <span
      className={[
        "inline-block h-[10px] w-[10px] rounded-full shrink-0",
        on ? "bg-[var(--success)]" : "bg-[var(--danger)]",
        pulse && on ? "animate-pulse" : "",
      ].join(" ")}
    />
  );
}
function Toggle({
  on,
  disabled,
  onToggle,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      disabled={disabled}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent-cyan)] focus:ring-offset-2",
        on ? "bg-[var(--success)]" : "bg-[var(--surface-muted)]",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-[20px] w-[20px] transform rounded-full bg-[var(--surface)] ring-1 ring-[var(--border-subtle)] transition duration-150 ease-in-out",
          on ? "translate-x-5" : "translate-x-[2px]",
        ].join(" ")}
      />
    </button>
  );
}
export function PipelineServices() {
  const [data, setData] = useState<StatusData | null>(null);
  const [isPending, startTransition] = useTransition();
  const load = useCallback(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((j) => j.ok && setData(j))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);
  const post = (
    body: Record<string, unknown>,
    optimistic: (d: StatusData) => StatusData,
  ) =>
    startTransition(async () => {
      setData((d) => (d ? optimistic(d) : d));
      await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      load();
    });
  if (!data) return null;
  const cronActive = !data.pipeline.paused;
  const workerActive = !data.worker.paused;
  return (
    <section>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
        PIPELINE SERVICES
      </p>
      <Card className="border-[var(--border-subtle)] shadow-none rounded-xl">
        <CardContent className="p-0 divide-y divide-[var(--border-subtle)]">
          <div className="flex items-center gap-3 px-4 py-3">
            <Dot on={data.cron.active && cronActive} />
            <span className="flex-1 text-[14px] font-medium text-[var(--text-primary)]">
              Pipeline
            </span>
            <span className="text-[12px] text-[var(--text-secondary)]">
              {data.pipeline.paused
                ? "paused"
                : data.cron.lastRun
                  ? `last run ${fmtAge(data.cron.ageMs)}`
                  : "not yet run"}
            </span>
            <Toggle
              on={cronActive}
              disabled={isPending}
              onToggle={() =>
                post({ pipeline_paused: cronActive }, (d) => ({
                  ...d,
                  pipeline: { paused: cronActive },
                }))
              }
            />
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <Dot on={data.worker.online && workerActive} pulse />
            <span className="flex-1 text-[14px] font-medium text-[var(--text-primary)]">
              AI Worker
            </span>
            <span className="text-[12px] text-[var(--text-secondary)]">
              {data.worker.paused
                ? "paused"
                : data.worker.online
                  ? `online · ${fmtAge(data.worker.ageMs)}`
                  : data.worker.lastSeen
                    ? `offline · last ${fmtAge(data.worker.ageMs)}`
                    : "offline · never seen"}
            </span>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
