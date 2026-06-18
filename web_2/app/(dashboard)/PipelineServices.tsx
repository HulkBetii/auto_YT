"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface StatusData {
  worker: { online: boolean; paused: boolean; lastSeen: string | null; ageMs: number | null };
  cron: { active: boolean; lastRun: string | null; ageMs: number | null };
  pipeline: { paused: boolean };
}

interface RunVeoWatcherData {
  available: boolean;
  running: boolean;
  pid: number | null;
  scriptPath: string;
  runVeoDir: string;
  message?: string;
}

const LOCAL_RUN_VEO_WATCHER_URL =
  process.env.NEXT_PUBLIC_LOCAL_RUN_VEO_WATCHER_URL ?? "http://localhost:3001/api/run-veo-watcher";

function getRunVeoWatcherUrl() {
  if (typeof window === "undefined") return "/api/run-veo-watcher";

  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "/api/run-veo-watcher";
  }

  return LOCAL_RUN_VEO_WATCHER_URL;
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
        on ? "bg-[#34C759]" : "bg-[#FF3B30]",
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
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[#007AFF] focus:ring-offset-2",
        on ? "bg-[#34C759]" : "bg-[#E5E5EA] dark:bg-[#3A3A3C]",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-[20px] w-[20px] transform rounded-full bg-white ring-1 ring-black/5 transition duration-150 ease-in-out",
          on ? "translate-x-5" : "translate-x-[2px]",
        ].join(" ")}
      />
    </button>
  );
}

export function PipelineServices() {
  const [data, setData] = useState<StatusData | null>(null);
  const [runVeoWatcher, setRunVeoWatcher] = useState<RunVeoWatcherData | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadRunVeoWatcher = useCallback(() => {
    fetch(getRunVeoWatcherUrl())
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setRunVeoWatcher(j.watcher);
        } else {
          setRunVeoWatcher({
            available: false,
            running: false,
            pid: null,
            scriptPath: "",
            runVeoDir: "",
            message: j.error ?? "RUN_VEO watcher unavailable",
          });
        }
      })
      .catch(() => {
        setRunVeoWatcher({
          available: false,
          running: false,
          pid: null,
          scriptPath: "",
          runVeoDir: "",
          message: "local helper offline",
        });
      });
  }, []);

  const load = useCallback(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((j) => j.ok && setData(j))
      .catch(() => {});
    loadRunVeoWatcher();
  }, [loadRunVeoWatcher]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const post = (body: Record<string, unknown>, optimistic: (d: StatusData) => StatusData) =>
    startTransition(async () => {
      setData((d) => (d ? optimistic(d) : d));
      await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      load();
    });

  const toggleRunVeoWatcher = () =>
    startTransition(async () => {
      const shouldStart = !(runVeoWatcher?.running ?? false);
      setRunVeoWatcher((watcher) => watcher ? { ...watcher, running: shouldStart } : watcher);
      try {
        const response = await fetch(getRunVeoWatcherUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: shouldStart ? "start" : "stop" }),
        });
        const result = await response.json();
        if (result.ok) {
          setRunVeoWatcher(result.watcher);
        } else {
          loadRunVeoWatcher();
        }
      } catch {
        loadRunVeoWatcher();
      }
    });

  if (!data) return null;

  const workerActive = !data.worker.paused;
  const cronActive = !data.pipeline.paused;
  const runVeoAvailable = runVeoWatcher?.available ?? false;
  const runVeoRunning = runVeoWatcher?.running ?? false;

  return (
    <section>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
        PIPELINE SERVICES
      </p>
      <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
        <CardContent className="p-0 divide-y divide-black/[.06] dark:divide-white/[.08]">

          {/* Web2 Pipeline */}
          <div className="flex items-center gap-3 px-4 py-3">
            <Dot on={data.cron.active && cronActive} />
            <span className="flex-1 text-[14px] font-medium text-[#1C1C1E] dark:text-white">
              Web2 Pipeline
            </span>
            <span className="text-[12px] text-[#AEAEB2]">
              {data.pipeline.paused
                ? "paused"
                : data.cron.lastRun
                  ? `last run ${fmtAge(data.cron.ageMs)}`
                  : "not yet run"}
            </span>
            <Toggle
              on={cronActive}
              disabled={isPending}
              onToggle={() => post(
                { pipeline_paused: cronActive },
                (d) => ({ ...d, pipeline: { paused: cronActive } }),
              )}
            />
          </div>

          {/* AI Worker */}
          <div className="flex items-center gap-3 px-4 py-3">
            <Dot on={data.worker.online && workerActive} pulse />
            <span className="flex-1 text-[14px] font-medium text-[#1C1C1E] dark:text-white">
              AI Worker
            </span>
            <span className="text-[12px] text-[#AEAEB2]">
              {data.worker.paused
                ? "paused"
                : data.worker.online
                  ? `online · ${fmtAge(data.worker.ageMs)}`
                  : data.worker.lastSeen
                    ? `offline · last ${fmtAge(data.worker.ageMs)}`
                    : "offline · never seen"}
            </span>
          </div>

          {/* RUN_VEO Watcher */}
          <div className="flex items-center gap-3 px-4 py-3">
            <Dot on={runVeoAvailable && runVeoRunning} pulse />
            <span className="flex-1 text-[14px] font-medium text-[#1C1C1E] dark:text-white">
              RUN_VEO Watcher
            </span>
            <span className="text-[12px] text-[#AEAEB2]">
              {!runVeoWatcher
                ? "checking..."
                : !runVeoWatcher.available
                  ? runVeoWatcher.message ?? "local helper offline"
                  : runVeoWatcher.running
                    ? `running · pid ${runVeoWatcher.pid ?? "?"}`
                    : "stopped"}
            </span>
            <Toggle
              on={runVeoRunning}
              disabled={isPending || !runVeoAvailable}
              onToggle={toggleRunVeoWatcher}
            />
          </div>

        </CardContent>
      </Card>
    </section>
  );
}
