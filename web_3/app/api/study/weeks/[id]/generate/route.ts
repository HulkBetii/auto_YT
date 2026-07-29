import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import {
  claimStudyAudioWeekForGeneration,
  getStudyAudioWeek,
  markStudyAudioWeekGenerationFailed,
} from "@/lib/db/repo/study";
import { getStudySettingValue, STUDY_SETTING_KEYS } from "@/lib/db/repo/study-settings";
import type { StudyMusicGenerationManifest } from "@/lib/db/schema";
import {
  getStudyWeekPaths,
  isFreshStudyMusicGeneration,
  STUDY_MUSIC_GENERATION_STALE_MS,
  STUDY_TRACKS_PER_WEEK,
} from "@/lib/study/project";
import { assertStudyAuth } from "../../../_auth";

export const runtime = "nodejs";

const PROMPT_VERSION = "study-organic-focus-v1";
const MAX_PROVIDER_TASKS = 20;
const LEGACY_PHASE_TASK_INDEX: Readonly<Record<string, number>> = {
  "First light setup": 1,
  "Morning momentum": 2,
  "Clear desk flow": 3,
  "Deep work warmth": 4,
  "Late-morning concentration": 5,
  "Midday reset": 6,
  "Quiet persistence": 7,
  "Afternoon clarity": 8,
  "Steady finish": 9,
  "Golden-hour closure": 10,
};

function workerScriptPath(): string {
  return path.join(process.cwd(), "scripts", "generate_study_music.py");
}

function pythonCommand(): string {
  const configured = process.env.ASSEMBLE_PYTHON?.trim();
  if (configured) return configured;
  const windowsPython = path.join(process.cwd(), "..", ".venv", "Scripts", "python.exe");
  if (process.platform === "win32" && existsSync(windowsPython)) return windowsPython;
  return process.platform === "win32" ? "python" : "python3";
}

function createGenerationManifest(now: Date): StudyMusicGenerationManifest {
  return {
    promptVersion: PROMPT_VERSION,
    provider: "ai33.pro",
    maxProviderTasks: MAX_PROVIDER_TASKS,
    tasks: [],
    slots: Array.from({ length: STUDY_TRACKS_PER_WEEK }, (_, index) => ({
      slotNumber: index + 1,
      taskIndex: Math.floor(index / 2) + 1,
      status: "pending" as const,
    })),
    lastKnownCredits: null,
    updatedAt: now.toISOString(),
  };
}

function resolveTaskIndex(
  record: { taskIndex?: number; phase?: string },
  label: string,
): number {
  const taskIndex = record.taskIndex;
  const legacyTaskIndex = record.phase ? LEGACY_PHASE_TASK_INDEX[record.phase] : undefined;
  if (taskIndex !== undefined && (!Number.isInteger(taskIndex) || taskIndex < 1 || taskIndex > 10)) {
    throw new Error(`${label} has an invalid taskIndex`);
  }
  if (record.phase !== undefined && legacyTaskIndex === undefined) {
    throw new Error(`${label} has an invalid legacy phase`);
  }
  if (taskIndex !== undefined && legacyTaskIndex !== undefined && taskIndex !== legacyTaskIndex) {
    throw new Error(`${label} has conflicting taskIndex and phase`);
  }
  const resolved = taskIndex ?? legacyTaskIndex;
  if (resolved === undefined) throw new Error(`${label} must define taskIndex or legacy phase`);
  return resolved;
}

function normalizeGenerationManifestForClaim(
  manifest: StudyMusicGenerationManifest,
  now: Date,
): StudyMusicGenerationManifest {
  const tasks = manifest.tasks.map((task) => {
    const taskIndex = resolveTaskIndex(task, `Task #${task.submissionIndex}`);
    const { phase: _phase, taskIndex: _taskIndex, ...rest } = task;
    return { ...rest, taskIndex };
  });
  const slots = manifest.slots.map((slot) => {
    const taskIndex = resolveTaskIndex(slot, `Slot #${slot.slotNumber}`);
    const expectedTaskIndex = Math.floor((slot.slotNumber - 1) / 2) + 1;
    if (taskIndex !== expectedTaskIndex) {
      throw new Error(`Slot #${slot.slotNumber} has an invalid taskIndex`);
    }
    const { phase: _phase, taskIndex: _taskIndex, ...rest } = slot;
    return { ...rest, taskIndex };
  });
  return { ...manifest, tasks, slots, updatedAt: now.toISOString() };
}

function generationProgress(manifest: StudyMusicGenerationManifest): number {
  return manifest.slots.filter((slot) => slot.status === "downloaded").length;
}

async function assertGenerationFilesAreManaged(
  audioDir: string,
  manifest: StudyMusicGenerationManifest | null,
): Promise<void> {
  const entries = await readdir(audioDir, { withFileTypes: true });
  const mp3Files = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".mp3")
    .map((entry) => entry.name);
  if (mp3Files.length === 0) return;
  if (!manifest) {
    throw new Error("Audio week already contains MP3 files; generation requires an empty week");
  }
  const managedFiles = new Set(
    manifest.slots
      .filter((slot) => slot.status === "downloaded" && slot.fileName)
      .map((slot) => slot.fileName!.toLowerCase()),
  );
  const unmanagedFiles = mp3Files.filter((fileName) => !managedFiles.has(fileName.toLowerCase()));
  if (unmanagedFiles.length > 0) {
    throw new Error(`Audio week contains unmanaged MP3 files: ${unmanagedFiles.join(", ")}`);
  }
}

async function spawnWorker(
  weekId: number,
  runId: string,
  generationDir: string,
  apiKey: string,
): Promise<string> {
  const logPath = path.join(generationDir, "generation.log");
  const logFile = openSync(logPath, "a");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(pythonCommand(), [workerScriptPath(), String(weekId), runId], {
        cwd: process.cwd(),
        detached: true,
        windowsHide: true,
        env: { ...process.env, SUNO_API_KEY: apiKey },
        stdio: ["ignore", logFile, logFile],
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
    return logPath;
  } finally {
    closeSync(logFile);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertStudyAuth(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const weekId = Number(id);
  if (!Number.isInteger(weekId) || weekId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid study audio week ID" }, { status: 400 });
  }

  const week = await getStudyAudioWeek(weekId);
  if (!week) return NextResponse.json({ ok: false, error: "Study audio week not found" }, { status: 404 });
  if (isFreshStudyMusicGeneration(week.status, week.generationHeartbeatAt)) {
    return NextResponse.json({ ok: false, error: "Study music is already generating" }, { status: 409 });
  }
  if (!["draft", "failed", "generating"].includes(week.status)) {
    return NextResponse.json(
      { ok: false, error: "Study audio week is already generated" },
      { status: 409 },
    );
  }
  const savedApiKey = (await getStudySettingValue(STUDY_SETTING_KEYS.ai33ApiKey))?.trim();
  const apiKey = savedApiKey || process.env.SUNO_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "AI33.PRO API key is not configured" }, { status: 500 });
  }
  if (!existsSync(workerScriptPath())) {
    return NextResponse.json({ ok: false, error: "Study music generator script is missing" }, { status: 500 });
  }

  const paths = getStudyWeekPaths(week.weekNumber);
  const generationDir = path.join(paths.audioDir, "_generation");
  const runId = randomUUID();
  const now = new Date();
  const isResume = week.generationManifest !== null;

  try {
    await mkdir(generationDir, { recursive: true });
    await assertGenerationFilesAreManaged(paths.audioDir, week.generationManifest);
    const generationManifest = week.generationManifest
      ? normalizeGenerationManifestForClaim(week.generationManifest, now)
      : createGenerationManifest(now);
    const claimed = await claimStudyAudioWeekForGeneration({
      id: week.id,
      runId,
      generationManifest,
      staleBefore: new Date(now.getTime() - STUDY_MUSIC_GENERATION_STALE_MS),
    });
    if (!claimed) {
      return NextResponse.json({ ok: false, error: "Study music is already generating" }, { status: 409 });
    }

    try {
      const logPath = await spawnWorker(week.id, runId, generationDir, apiKey);
      return NextResponse.json(
        {
          ok: true,
          weekId: week.id,
          status: "generating",
          mode: isResume ? "resume" : "start",
          progress: generationProgress(generationManifest),
          taskCount: generationManifest.tasks.length,
          maxProviderTasks: generationManifest.maxProviderTasks,
          logPath,
        },
        { status: 202 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markStudyAudioWeekGenerationFailed({ id: week.id, runId, errorMessage: message });
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[study/weeks/${week.id}/generate]`, message);
    const status = message.includes("MP3 files") ? 409 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
