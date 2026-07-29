import { closeSync, existsSync, openSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import {
  claimStudyDailyVideoForAssembly,
  findDuplicateStudyFootageHashes,
  getStudyAudioWeek,
  getStudyDailyVideo,
  markStudyDailyVideoFailed,
} from "@/lib/db/repo/study";
import {
  assertSufficientStudyDiskSpace,
  createStudyInputSignature,
  scanStudyFootage,
} from "@/lib/study/media";
import {
  ensureStudyDayDirs,
  isFreshStudyAssembly,
  isFreshStudyPreview,
  resolveStudyOverlayFontPath,
  STUDY_ASSEMBLY_STALE_MS,
  STUDY_PREVIEW_STALE_MS,
  STUDY_TRACKS_PER_WEEK,
} from "@/lib/study/project";
import { assertStudyAuth } from "../../../_auth";

export const runtime = "nodejs";

function assemblerScriptPath(): string {
  return path.join(process.cwd(), "scripts", "assemble_study_video.py");
}

function pythonCommand(): string {
  const configured = process.env.ASSEMBLE_PYTHON?.trim();
  if (configured) return configured;
  const windowsPython = path.join(process.cwd(), "..", ".venv", "Scripts", "python.exe");
  if (process.platform === "win32" && existsSync(windowsPython)) return windowsPython;
  return process.platform === "win32" ? "python" : "python3";
}

async function spawnAssembler(videoId: number, logPath: string): Promise<void> {
  const logFile = openSync(logPath, "a");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(pythonCommand(), [assemblerScriptPath(), String(videoId)], {
        cwd: process.cwd(),
        detached: true,
        windowsHide: true,
        env: process.env,
        stdio: ["ignore", logFile, logFile],
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  } finally {
    closeSync(logFile);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertStudyAuth(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const videoId = Number(id);
  if (!Number.isInteger(videoId) || videoId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid study video ID" }, { status: 400 });
  }

  const video = await getStudyDailyVideo(videoId);
  if (!video) return NextResponse.json({ ok: false, error: "Study video not found" }, { status: 404 });
  if (isFreshStudyAssembly(video.status, video.assemblyStartedAt)) {
    return NextResponse.json({ ok: false, error: "Study video is already assembling" }, { status: 409 });
  }
  if (isFreshStudyPreview(video.previewStatus, video.previewHeartbeatAt)) {
    return NextResponse.json({ ok: false, error: "Study video preview is currently rendering" }, { status: 409 });
  }
  const week = await getStudyAudioWeek(video.weekId);
  if (
    !week ||
    week.status !== "ready" ||
    !week.rightsVerifiedAt ||
    week.trackManifest?.files.length !== STUDY_TRACKS_PER_WEEK
  ) {
    return NextResponse.json(
      { ok: false, error: "Study audio week is not ready or commercial rights are unverified" },
      { status: 409 },
    );
  }
  if (!existsSync(assemblerScriptPath())) {
    return NextResponse.json({ ok: false, error: "Study assembler script is missing" }, { status: 500 });
  }
  try {
    resolveStudyOverlayFontPath();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  let assemblyClaimed = false;
  let assemblyStartedAt: Date | null = null;
  try {
    const paths = await ensureStudyDayDirs(video.dayNumber);
    const footageManifest = await scanStudyFootage(paths.sourceDir, paths.mediaRoot);
    const duplicates = await findDuplicateStudyFootageHashes(
      footageManifest.files.map((file) => file.sha256),
      video.id,
    );
    if (duplicates.length > 0) {
      const days = [...new Set(duplicates.map((duplicate) => duplicate.dayNumber))].join(", ");
      throw new Error(`Footage was already used on day(s): ${days}`);
    }
    const totalFootageBytes = footageManifest.files.reduce((total, file) => total + file.sizeBytes, 0);
    await assertSufficientStudyDiskSpace(paths.outputDir, totalFootageBytes);
    const durationSec = Math.round(
      footageManifest.files.reduce((total, file) => total + file.durationSec, 0),
    );
    const inputSignature = createStudyInputSignature({
      dayNumber: video.dayNumber,
      weekNumber: week.weekNumber,
      footageSha256s: footageManifest.files.map((file) => file.sha256),
      trackSha256s: week.trackManifest.files.map((file) => file.sha256),
    });
    assemblyStartedAt = await claimStudyDailyVideoForAssembly({
      id: video.id,
      footageManifest,
      durationSec,
      inputSignature,
      staleBefore: new Date(Date.now() - STUDY_ASSEMBLY_STALE_MS),
      previewStaleBefore: new Date(Date.now() - STUDY_PREVIEW_STALE_MS),
    });
    if (!assemblyStartedAt) {
      return NextResponse.json(
        { ok: false, error: "Study video assembly or preview is already running" },
        { status: 409 },
      );
    }
    assemblyClaimed = true;

    await spawnAssembler(video.id, paths.logPath);
    return NextResponse.json(
      { ok: true, videoId: video.id, status: "assembling", logPath: paths.logPath },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markStudyDailyVideoFailed(
      video.id,
      message,
      assemblyClaimed ? assemblyStartedAt : null,
    );
    console.error(`[study/videos/${video.id}/assemble]`, message);
    return NextResponse.json({ ok: false, error: message }, { status: assemblyClaimed ? 500 : 400 });
  }
}
