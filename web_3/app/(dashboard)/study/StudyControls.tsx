"use client";

import {
  CheckCircle2,
  CircleAlert,
  Coins,
  Gauge,
  Loader2,
  Music2,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OpenFolderButton } from "../videos/[id]/OpenFolderButton";

interface ApiError {
  error?: string;
}

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as ApiError | null;
  if (!response.ok) {
    throw new Error(result?.error ?? "Request failed.");
  }
}

function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-[12px] text-[var(--danger)]">{message}</p>;
}

interface GenerationProgress {
  downloadedSlots: number;
  totalSlots: number;
  tasksUsed: number;
  maxProviderTasks: number | null;
  lastKnownCredits: number | null;
  latestError: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function generationProgress(value: unknown): GenerationProgress {
  const manifest = asRecord(value);
  const tasks = Array.isArray(manifest?.tasks) ? manifest.tasks : [];
  const slots = Array.isArray(manifest?.slots) ? manifest.slots : [];
  const downloadedSlots = slots.filter((slot) => asRecord(slot)?.status === "downloaded").length;
  const latestError = [...tasks]
    .reverse()
    .map((task) => asRecord(task)?.errorMessage)
    .find((error): error is string => typeof error === "string" && error.trim().length > 0) ?? null;
  const maxProviderTasks = manifest?.maxProviderTasks;
  const lastKnownCredits = manifest?.lastKnownCredits;

  return {
    downloadedSlots,
    totalSlots: Math.max(20, slots.length),
    tasksUsed: tasks.length,
    maxProviderTasks: typeof maxProviderTasks === "number" ? maxProviderTasks : null,
    lastKnownCredits: typeof lastKnownCredits === "number" ? lastKnownCredits : null,
    latestError,
  };
}

export function CreateWeekForm({ defaultWeek }: { defaultWeek: number }) {
  const router = useRouter();
  const [weekNumber, setWeekNumber] = useState(defaultWeek);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await postJson("/api/study/weeks", { weekNumber });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cannot create week.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={15}
          value={weekNumber}
          onChange={(event) => setWeekNumber(Number(event.target.value))}
          aria-label="Week number"
          className="w-24"
          required
        />
        <Button type="submit" size="sm" disabled={isLoading} className="gap-1.5">
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Create week
        </Button>
      </div>
      <InlineError message={error} />
    </form>
  );
}

export function CreateDayForm({ defaultDay }: { defaultDay: number }) {
  const router = useRouter();
  const [dayNumber, setDayNumber] = useState(defaultDay);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await postJson("/api/study/videos", { dayNumber });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cannot create day.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={100}
          value={dayNumber}
          onChange={(event) => setDayNumber(Number(event.target.value))}
          aria-label="Day number"
          className="w-24"
          required
        />
        <Button type="submit" size="sm" disabled={isLoading} className="gap-1.5">
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Create day
        </Button>
      </div>
      <InlineError message={error} />
    </form>
  );
}

export function StudyWeekActions({
  weekId,
  audioFolderPath,
  status,
  generationManifest,
}: {
  weekId: number;
  audioFolderPath: string;
  status: string;
  generationManifest: unknown;
}) {
  const router = useRouter();
  const isReady = status === "ready";
  const isGenerating = status === "generating";
  const isAwaitingRights = status === "awaiting_rights";
  const progress = generationProgress(generationManifest);
  const [rightsConfirmed, setRightsConfirmed] = useState(isReady);
  const [isScanning, setIsScanning] = useState(false);
  const [isGeneratingRequest, setIsGeneratingRequest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateTracks() {
    setError(null);
    setIsGeneratingRequest(true);
    try {
      await postJson(`/api/study/weeks/${weekId}/generate`, {});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cannot generate tracks.");
    } finally {
      setIsGeneratingRequest(false);
    }
  }

  async function scanWeek() {
    setError(null);
    setIsScanning(true);
    try {
      await postJson(`/api/study/weeks/${weekId}/scan`, {
        confirmCommercialRights: true,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cannot scan audio.");
    } finally {
      setIsScanning(false);
    }
  }

  const hasGenerationHistory = progress.tasksUsed > 0 || progress.downloadedSlots > 0;
  const generationDisabled = isGeneratingRequest || isGenerating || isAwaitingRights || isReady;
  const generationLabel = isGenerating
    ? "Generating tracks"
    : isAwaitingRights
      ? "Tracks awaiting rights"
      : isReady
        ? "20 tracks ready"
        : hasGenerationHistory
          ? "Resume generation"
          : "Generate 20 tracks";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={generateTracks}
          disabled={generationDisabled}
          className="h-7 gap-1.5 bg-[var(--accent-cyan)] text-[12px] text-[var(--dashboard-bg)] hover:bg-[var(--accent-cyan-hover)]"
        >
          {isGeneratingRequest || isGenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : hasGenerationHistory && !isAwaitingRights && !isReady ? (
            <RefreshCw className="h-3.5 w-3.5" />
          ) : (
            <Music2 className="h-3.5 w-3.5" />
          )}
          {generationLabel}
        </Button>
        <OpenFolderButton
          folderPath={audioFolderPath}
          label="Open audio"
          title="Open weekly audio folder"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={scanWeek}
          disabled={isScanning || isGeneratingRequest || isGenerating || !rightsConfirmed}
          className="h-7 gap-1.5 text-[12px]"
        >
          {isScanning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isReady ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Music2 className="h-3.5 w-3.5" />
          )}
          Scan 20 tracks
        </Button>
      </div>
      {(hasGenerationHistory || isGenerating || isAwaitingRights) && (
        <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--text-secondary)]">
            <span>{progress.downloadedSlots}/{progress.totalSlots} tracks downloaded</span>
            <span>{Math.round((progress.downloadedSlots / progress.totalSlots) * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border-subtle)]">
            <div
              className="h-full rounded-full bg-[var(--accent-cyan)] transition-[width] duration-300"
              style={{ width: `${Math.min(100, (progress.downloadedSlots / progress.totalSlots) * 100)}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              {progress.tasksUsed} tasks used
              {progress.maxProviderTasks === null ? "" : ` (cap ${progress.maxProviderTasks})`}
            </span>
            <span className="inline-flex items-center gap-1">
              <Coins className="h-3 w-3" />
              {progress.lastKnownCredits === null
                ? "Credits unknown"
                : `${progress.lastKnownCredits.toLocaleString()} credits left`}
            </span>
          </div>
          {progress.latestError && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--danger)]">
              <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              {progress.latestError}
            </p>
          )}
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={rightsConfirmed}
          onChange={(event) => setRightsConfirmed(event.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--accent-cyan)]"
        />
        I confirm commercial rights for these tracks
      </label>
      <InlineError message={error} />
    </div>
  );
}

export function StudyDayActions({
  videoId,
  sourceFolderPath,
  outputFolderPath,
  status,
  isFreshAssembly,
}: {
  videoId: number;
  sourceFolderPath: string;
  outputFolderPath: string;
  status: string;
  isFreshAssembly: boolean;
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAssembling = status === "assembling";

  async function assemble() {
    setError(null);
    setIsLoading(true);
    try {
      await postJson(`/api/study/videos/${videoId}/assemble`, {});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cannot start assembly.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <OpenFolderButton
          folderPath={sourceFolderPath}
          label="Open source"
          title="Open daily footage folder"
        />
        <OpenFolderButton
          folderPath={outputFolderPath}
          label="Open output"
          title="Open daily output folder"
        />
        <Button
          type="button"
          size="sm"
          onClick={assemble}
          disabled={isLoading || isFreshAssembly}
          className="h-7 gap-1.5 bg-[var(--accent-cyan)] text-[var(--dashboard-bg)] hover:bg-[var(--accent-cyan-hover)] text-[12px]"
        >
          {isLoading || isFreshAssembly ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {isFreshAssembly
            ? "Assembling"
            : isAssembling
              ? "Retry assemble"
              : "Assemble"}
        </Button>
      </div>
      <InlineError message={error} />
    </div>
  );
}
