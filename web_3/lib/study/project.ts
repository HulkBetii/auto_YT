import path from "node:path";
import { statSync } from "node:fs";
import { mkdir } from "node:fs/promises";

import { z } from "zod";

export const STUDY_TOTAL_DAYS = 100;
export const STUDY_DAYS_PER_WEEK = 7;
export const STUDY_MAX_WEEKS = Math.ceil(STUDY_TOTAL_DAYS / STUDY_DAYS_PER_WEEK);
export const STUDY_TRACKS_PER_WEEK = 20;
export const STUDY_AUDIO_CROSSFADE_SEC = 3;
export const STUDY_ASSEMBLY_STALE_MS = 4 * 60 * 60 * 1000;
export const STUDY_PREVIEW_DURATION_SEC = 90;
export const STUDY_PREVIEW_STALE_MS = 30 * 60 * 1000;
export const STUDY_MUSIC_GENERATION_STALE_MS = 5 * 60 * 1000;
export const DEFAULT_STUDY_MEDIA_ROOT = String.raw`D:\VibeCoding\STUDY_WITH_ME`;
export const DEFAULT_STUDY_OVERLAY_FONT = String.raw`C:\Windows\Fonts\consolab.ttf`;
export const STUDY_OVERLAY_FONT_ENV = "STUDY_OVERLAY_FONT";

export const StudyWeekCreateSchema = z.object({
  weekNumber: z.number().int().min(1).max(STUDY_MAX_WEEKS),
});

export const StudyWeekScanSchema = z.object({
  confirmCommercialRights: z.boolean(),
});

export const StudyVideoCreateSchema = z.object({
  dayNumber: z.number().int().min(1).max(STUDY_TOTAL_DAYS),
});

export const StudyVideoPreviewSchema = z.object({
  atSeconds: z.number().finite().nonnegative().default(0),
});

export function weekNumberForDay(dayNumber: number): number {
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > STUDY_TOTAL_DAYS) {
    throw new Error(`dayNumber must be an integer between 1 and ${STUDY_TOTAL_DAYS}`);
  }
  return Math.ceil(dayNumber / STUDY_DAYS_PER_WEEK);
}

export function clampStudyPreviewWindow(
  requestedOffsetSec: number,
  totalDurationSec: number,
): { actualOffsetSec: number; durationSec: number } {
  if (!Number.isFinite(requestedOffsetSec) || requestedOffsetSec < 0) {
    throw new Error("Preview offset must be a finite non-negative number");
  }
  if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
    throw new Error("Preview source duration must be a finite positive number");
  }
  return {
    actualOffsetSec: Math.min(
      requestedOffsetSec,
      Math.max(0, totalDurationSec - STUDY_PREVIEW_DURATION_SEC),
    ),
    durationSec: Math.min(STUDY_PREVIEW_DURATION_SEC, totalDurationSec),
  };
}

export function isFreshStudyAssembly(
  status: string,
  assemblyStartedAt: Date | null,
  now = new Date(),
): boolean {
  return status === "assembling"
    && assemblyStartedAt !== null
    && assemblyStartedAt.getTime() > now.getTime() - STUDY_ASSEMBLY_STALE_MS;
}

export function isFreshStudyPreview(
  status: string,
  heartbeatAt: Date | null,
  now = new Date(),
): boolean {
  return status === "rendering"
    && heartbeatAt !== null
    && heartbeatAt.getTime() > now.getTime() - STUDY_PREVIEW_STALE_MS;
}

export function isFreshStudyMusicGeneration(
  status: string,
  heartbeatAt: Date | null,
  now = new Date(),
): boolean {
  return status === "generating"
    && heartbeatAt !== null
    && heartbeatAt.getTime() > now.getTime() - STUDY_MUSIC_GENERATION_STALE_MS;
}

export function studyAudioWeekStatusForRights(
  rightsVerifiedAt: Date | null,
): "awaiting_rights" | "ready" {
  return rightsVerifiedAt ? "ready" : "awaiting_rights";
}

function paddedNumber(value: number): string {
  return String(value).padStart(3, "0");
}

export function getStudyMediaRoot(): string {
  return path.resolve(process.env.STUDY_MEDIA_ROOT?.trim() || DEFAULT_STUDY_MEDIA_ROOT);
}

export function resolveStudyOverlayFontPath(): string {
  const fontPath = process.env[STUDY_OVERLAY_FONT_ENV]?.trim() || DEFAULT_STUDY_OVERLAY_FONT;
  if (!path.isAbsolute(fontPath)) {
    throw new Error(
      `${STUDY_OVERLAY_FONT_ENV} must be an absolute path to an existing font file: ${fontPath}`,
    );
  }
  try {
    if (!statSync(fontPath).isFile()) throw new Error("not a regular file");
  } catch {
    throw new Error(
      `${STUDY_OVERLAY_FONT_ENV} must be an absolute path to an existing font file: ${fontPath}`,
    );
  }
  return path.resolve(fontPath);
}

export function getStudyWeekPaths(weekNumber: number) {
  const mediaRoot = getStudyMediaRoot();
  const audioDir = path.join(mediaRoot, "audio", `week-${paddedNumber(weekNumber)}`);
  return { mediaRoot, audioDir };
}

export function getStudyDayPaths(dayNumber: number) {
  const mediaRoot = getStudyMediaRoot();
  const dayDir = path.join(mediaRoot, "daily", `day-${paddedNumber(dayNumber)}`);
  const sourceDir = path.join(dayDir, "source");
  const workDir = path.join(dayDir, "work");
  const outputDir = path.join(dayDir, "output");
  return {
    mediaRoot,
    dayDir,
    sourceDir,
    workDir,
    outputDir,
    masterVideoPath: path.join(workDir, "master_silent.mp4"),
    finalVideoPath: path.join(outputDir, "final_video.mp4"),
    previewVideoPath: path.join(outputDir, "preview.mp4"),
    logPath: path.join(outputDir, "assembly.log"),
    previewLogPath: path.join(outputDir, "preview.log"),
  };
}

export async function ensureStudyWeekDirs(weekNumber: number) {
  const paths = getStudyWeekPaths(weekNumber);
  await mkdir(paths.audioDir, { recursive: true });
  return paths;
}

export async function ensureStudyDayDirs(dayNumber: number) {
  const paths = getStudyDayPaths(dayNumber);
  await Promise.all([
    mkdir(paths.sourceDir, { recursive: true }),
    mkdir(paths.workDir, { recursive: true }),
    mkdir(paths.outputDir, { recursive: true }),
  ]);
  return paths;
}
