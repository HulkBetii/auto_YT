"use client";

import { useEffect, useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface StatusData {
  worker: { online: boolean; lastSeen: string | null; ageMs: number | null };
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
        "inline-block h-2 w-2 rounded-full shrink-0",
        on ? "bg-[#34C759]" : "bg-[#FF3B30]",
        pulse && on ? "animate-pulse" : "",
      ].join(" ")}
    />
  );
}

export function PipelineServices() {
  const [data, setData] = useState<StatusData | null>(null);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((j) => j.ok && setData(j))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const togglePause = () => {
    if (!data) return;
    const next = !data.pipeline.paused;
    startTransition(async () => {
      await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_paused: next }),
      });
      setData((d) => d && { ...d, pipeline: { paused: next } });
    });
  };

  if (!data) return null;

  const rows = [
    {
      label: "Worker (Python)",
      ok: data.worker.online,
      detail: data.worker.online
        ? `online · ${fmtAge(data.worker.ageMs)}`
        : data.worker.lastSeen
          ? `offline · last ${fmtAge(data.worker.ageMs)}`
          : "offline · never seen",
      pulse: true,
      toggle: null,
    },
    {
      label: "Vercel Cron",
      ok: data.cron.active && !data.pipeline.paused,
      detail: data.pipeline.paused
        ? "paused"
        : data.cron.lastRun
          ? `last run ${fmtAge(data.cron.ageMs)}`
          : "not yet run",
      pulse: false,
      toggle: {
        label: data.pipeline.paused ? "Resume" : "Pause",
        action: togglePause,
        danger: !data.pipeline.paused,
      },
    },
    {
      label: "AI33 TTS",
      ok: true,
      detail: "fire-and-poll · ElevenLabs v1",
      pulse: false,
      toggle: null,
    },
  ];

  return (
    <section>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
        PIPELINE SERVICES
      </p>
      <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
        <CardContent className="p-0 divide-y divide-black/[.06] dark:divide-white/[.08]">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center gap-3 px-4 py-3">
              <Dot on={row.ok} pulse={row.pulse} />
              <span className="flex-1 text-[14px] font-medium text-[#1C1C1E] dark:text-white">
                {row.label}
              </span>
              <span className="text-[12px] text-[#AEAEB2]">{row.detail}</span>
              {row.toggle && (
                <button
                  onClick={row.toggle.action}
                  disabled={isPending}
                  className={[
                    "ml-2 rounded-md px-3 py-1 text-[12px] font-medium transition-colors",
                    row.toggle.danger
                      ? "bg-[#FF3B30]/10 text-[#FF3B30] hover:bg-[#FF3B30]/20"
                      : "bg-[#34C759]/10 text-[#34C759] hover:bg-[#34C759]/20",
                    isPending ? "opacity-50 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  {row.toggle.label}
                </button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
