import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import {
  claimStudyAudioWeekTrackRegeneration,
  getStudyAudioWeek,
  restoreStudyAudioWeekAfterRegenerationLaunchFailure,
} from "@/lib/db/repo/study";
import { getStudySettingValue, STUDY_SETTING_KEYS } from "@/lib/db/repo/study-settings";
import type {
  StudyMusicGenerationManifest,
  StudyMusicGenerationSlot,
  StudyMusicGenerationTask,
} from "@/lib/db/schema";
import {
  getStudyWeekPaths,
  isFreshStudyMusicGeneration,
  STUDY_MUSIC_GENERATION_STALE_MS,
  STUDY_TRACKS_PER_WEEK,
} from "@/lib/study/project";
import { assertStudyAuth } from "../../../../../_auth";

export const runtime = "nodejs";

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
  return path.join(process.cwd(), "scripts", "regenerate_study_music.py");
}

function pythonCommand(): string {
  const configured = process.env.ASSEMBLE_PYTHON?.trim();
  if (configured) return configured;
  const windowsPython = path.join(process.cwd(), "..", ".venv", "Scripts", "python.exe");
  if (process.platform === "win32" && existsSync(windowsPython)) return windowsPython;
  return process.platform === "win32" ? "python" : "python3";
}

function taskIndexFor(record: { taskIndex?: number; phase?: string }, label: string): number {
  const legacyTaskIndex = record.phase ? LEGACY_PHASE_TASK_INDEX[record.phase] : undefined;
  if (record.taskIndex !== undefined && (
    !Number.isInteger(record.taskIndex) || record.taskIndex < 1 || record.taskIndex > 10
  )) {
    throw new Error(`${label} has an invalid taskIndex`);
  }
  if (record.phase !== undefined && legacyTaskIndex === undefined) {
    throw new Error(`${label} has an invalid legacy phase`);
  }
  if (
    record.taskIndex !== undefined
    && legacyTaskIndex !== undefined
    && record.taskIndex !== legacyTaskIndex
  ) {
    throw new Error(`${label} has conflicting taskIndex and phase`);
  }
  const resolved = record.taskIndex ?? legacyTaskIndex;
  if (resolved === undefined) throw new Error(`${label} has no task identity`);
  return resolved;
}

function normalizeManifest(
  manifest: StudyMusicGenerationManifest,
  updatedAt: string,
): StudyMusicGenerationManifest {
  return {
    ...manifest,
    tasks: manifest.tasks.map((task) => {
      const taskIndex = taskIndexFor(task, `Task #${task.submissionIndex}`);
      const rest = { ...task } as typeof task & { phase?: string };
      delete rest.phase;
      return { ...rest, taskIndex } as StudyMusicGenerationTask;
    }),
    slots: manifest.slots.map((slot) => {
      const taskIndex = taskIndexFor(slot, `Slot #${slot.slotNumber}`);
      const rest = { ...slot } as typeof slot & { phase?: string };
      delete rest.phase;
      return { ...rest, taskIndex } as StudyMusicGenerationSlot;
    }),
    updatedAt,
  };
}

function dateFromJournal(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Regeneration journal has invalid rights data");
  return date;
}

async function spawnWorker(
  weekId: number,
  runId: string,
  slot: number,
  generationDir: string,
  apiKey: string,
): Promise<string> {
  const logPath = path.join(generationDir, "generation.log");
  const logFile = openSync(logPath, "a");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        pythonCommand(),
        [workerScriptPath(), String(weekId), runId, String(slot)],
        {
          cwd: process.cwd(),
          detached: true,
          windowsHide: true,
          env: { ...process.env, SUNO_API_KEY: apiKey },
          stdio: ["ignore", logFile, logFile],
        },
      );
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

export async function POST(request: Request, context: {
  params: Promise<{ id: string; slot: string }>;
}) {
  if (!(await assertStudyAuth(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id, slot: rawSlot } = await context.params;
  const weekId = Number(id);
  const slot = Number(rawSlot);
  if (!Number.isInteger(weekId) || weekId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid study audio week ID" }, { status: 400 });
  }
  if (!Number.isInteger(slot) || slot < 1 || slot > STUDY_TRACKS_PER_WEEK) {
    return NextResponse.json({ ok: false, error: "Track slot must be between 1 and 20" }, { status: 400 });
  }

  const week = await getStudyAudioWeek(weekId);
  if (!week) {
    return NextResponse.json({ ok: false, error: "Study audio week not found" }, { status: 404 });
  }
  if (isFreshStudyMusicGeneration(week.status, week.generationHeartbeatAt)) {
    return NextResponse.json({ ok: false, error: "Study music is already generating" }, { status: 409 });
  }
  if (!week.generationManifest || !week.trackManifest) {
    return NextResponse.json({ ok: false, error: "The album must contain 20 generated tracks" }, { status: 409 });
  }

  const now = new Date();
  let manifest: StudyMusicGenerationManifest;
  try {
    manifest = normalizeManifest(week.generationManifest, now.toISOString());
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 409 },
    );
  }
  const targetSlot = manifest.slots[slot - 1] as StudyMusicGenerationSlot | undefined;
  const targetTrack = week.trackManifest.files.find((track) => track.fileName === `${String(slot).padStart(2, "0")}.mp3`);
  const expectedFileNames = new Set(
    Array.from({ length: STUDY_TRACKS_PER_WEEK }, (_, index) => `${String(index + 1).padStart(2, "0")}.mp3`),
  );
  if (
    manifest.provider !== "ai33.pro"
    || manifest.maxProviderTasks !== 20
    || manifest.tasks.length > manifest.maxProviderTasks
    || manifest.slots.length !== STUDY_TRACKS_PER_WEEK
    || week.trackManifest.files.length !== STUDY_TRACKS_PER_WEEK
    || manifest.slots.some((item, index) => item.slotNumber !== index + 1 || item.status !== "downloaded")
    || week.trackManifest.files.some((track) => !expectedFileNames.has(track.fileName))
    || !targetSlot
    || targetSlot.slotNumber !== slot
    || targetSlot.status !== "downloaded"
    || !targetTrack
  ) {
    return NextResponse.json({ ok: false, error: "The album must contain 20 valid generated tracks" }, { status: 409 });
  }

  const existingJournal = manifest.activeRegeneration;
  const isResume = week.status === "generating";
  if (isResume && (!existingJournal || existingJournal.targetSlot !== slot)) {
    return NextResponse.json({ ok: false, error: "A different stale generation operation owns this week" }, { status: 409 });
  }
  if (
    isResume
    && !["ready", "awaiting_rights"].includes(existingJournal!.previousStatus)
  ) {
    return NextResponse.json({ ok: false, error: "Regeneration journal has an invalid previous status" }, { status: 409 });
  }
  if (!isResume && !["ready", "awaiting_rights"].includes(week.status)) {
    return NextResponse.json({ ok: false, error: "Only a completed 20-track album can regenerate a track" }, { status: 409 });
  }
  const isResumingSubmittedTask = isResume && existingJournal?.submissionIndex !== undefined;
  if (!isResumingSubmittedTask && manifest.tasks.length >= manifest.maxProviderTasks) {
    return NextResponse.json({ ok: false, error: "AI33 provider task cap reached" }, { status: 409 });
  }

  const paths = getStudyWeekPaths(week.weekNumber);
  const missingTrack = week.trackManifest.files.find(
    (track) => !existsSync(path.join(paths.audioDir, track.fileName)),
  );
  if (missingTrack) {
    return NextResponse.json({ ok: false, error: `Track file is missing: ${missingTrack.fileName}` }, { status: 409 });
  }
  const savedApiKey = (await getStudySettingValue(STUDY_SETTING_KEYS.ai33ApiKey))?.trim();
  const apiKey = savedApiKey || process.env.SUNO_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "AI33.PRO API key is not configured" }, { status: 500 });
  }
  if (!existsSync(workerScriptPath())) {
    return NextResponse.json({ ok: false, error: "Study track regenerator script is missing" }, { status: 500 });
  }

  const runId = randomUUID();
  const previousStatus = isResume
    ? existingJournal!.previousStatus
    : week.status as "ready" | "awaiting_rights";
  const previousRightsVerifiedAt = isResume
    ? existingJournal!.previousRightsVerifiedAt
    : week.rightsVerifiedAt?.toISOString() ?? null;
  manifest.activeRegeneration = isResume
    ? { ...existingJournal!, runId, updatedAt: now.toISOString() }
    : {
        runId,
        targetSlot: slot,
        previousStatus,
        previousRightsVerifiedAt,
        state: "claimed",
        originalSlot: structuredClone(targetSlot),
        originalTrack: structuredClone(targetTrack),
        startedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

  const claimed = await claimStudyAudioWeekTrackRegeneration({
    id: week.id,
    runId,
    generationManifest: manifest,
    expectedUpdatedAt: week.updatedAt,
    staleBefore: new Date(now.getTime() - STUDY_MUSIC_GENERATION_STALE_MS),
  });
  if (!claimed) {
    return NextResponse.json({ ok: false, error: "Study music is already generating" }, { status: 409 });
  }

  const generationDir = path.join(paths.audioDir, "_generation");
  try {
    await mkdir(generationDir, { recursive: true });
    const logPath = await spawnWorker(week.id, runId, slot, generationDir, apiKey);
    return NextResponse.json({
      ok: true,
      weekId: week.id,
      slot,
      status: "generating",
      mode: isResume ? "resume" : "regenerate",
      taskCount: manifest.tasks.length,
      maxProviderTasks: manifest.maxProviderTasks,
      logPath,
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const restoredManifest = { ...manifest };
    delete restoredManifest.activeRegeneration;
    await restoreStudyAudioWeekAfterRegenerationLaunchFailure({
      id: week.id,
      runId,
      status: previousStatus,
      rightsVerifiedAt: dateFromJournal(previousRightsVerifiedAt),
      generationManifest: restoredManifest,
      errorMessage: message,
    });
    console.error(`[study/weeks/${week.id}/tracks/${slot}/regenerate]`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
