import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import {
  claimStudyDailyVideoForPreview,
  getStudyAudioWeek,
  getStudyDailyVideo,
  markStudyDailyVideoPreviewFailed,
} from "@/lib/db/repo/study";
import { scanStudyFootage } from "@/lib/study/media";
import {
  clampStudyPreviewWindow,
  ensureStudyDayDirs,
  isFreshStudyAssembly,
  isFreshStudyPreview,
  resolveStudyOverlayFontPath,
  STUDY_ASSEMBLY_STALE_MS,
  STUDY_PREVIEW_STALE_MS,
  STUDY_TRACKS_PER_WEEK,
  StudyVideoPreviewSchema,
} from "@/lib/study/project";
import { assertStudyAuth } from "../../../_auth";

export const runtime = "nodejs";

function previewWorkerScriptPath(): string {
  return path.join(process.cwd(), "scripts", "assemble_study_video.py");
}

function pythonCommand(): string {
  const configured = process.env.ASSEMBLE_PYTHON?.trim();
  if (configured) return configured;
  const windowsPython = path.join(process.cwd(), "..", ".venv", "Scripts", "python.exe");
  if (process.platform === "win32" && existsSync(windowsPython)) return windowsPython;
  return process.platform === "win32" ? "python" : "python3";
}

async function spawnPreviewWorker(
  videoId: number,
  runId: string,
  logPath: string,
): Promise<void> {
  const logFile = openSync(logPath, "a");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        pythonCommand(),
        [previewWorkerScriptPath(), String(videoId), "--preview-run-id", runId],
        {
          cwd: process.cwd(),
          detached: true,
          windowsHide: true,
          env: process.env,
          stdio: ["ignore", logFile, logFile],
        },
      );
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
  const parsed = StudyVideoPreviewSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid preview offset" }, { status: 400 });
  }

  const video = await getStudyDailyVideo(videoId);
  if (!video) return NextResponse.json({ ok: false, error: "Study video not found" }, { status: 404 });
  if (isFreshStudyAssembly(video.status, video.assemblyStartedAt)) {
    return NextResponse.json({ ok: false, error: "Study video is currently assembling" }, { status: 409 });
  }
  if (isFreshStudyPreview(video.previewStatus, video.previewHeartbeatAt)) {
    return NextResponse.json({ ok: false, error: "Study video preview is already rendering" }, { status: 409 });
  }

  const week = await getStudyAudioWeek(video.weekId);
  if (
    !week
    || week.status !== "ready"
    || !week.rightsVerifiedAt
    || week.trackManifest?.files.length !== STUDY_TRACKS_PER_WEEK
  ) {
    return NextResponse.json(
      { ok: false, error: "Study audio week is not ready or commercial rights are unverified" },
      { status: 409 },
    );
  }
  if (!existsSync(previewWorkerScriptPath())) {
    return NextResponse.json({ ok: false, error: "Study preview worker script is missing" }, { status: 500 });
  }
  try {
    resolveStudyOverlayFontPath();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const runId = randomUUID();
  let claimed = false;
  try {
    const paths = await ensureStudyDayDirs(video.dayNumber);
    const footageManifest = await scanStudyFootage(paths.sourceDir, paths.mediaRoot);
    const totalDurationSec = footageManifest.files.reduce(
      (total, file) => total + file.durationSec,
      0,
    );
    const window = clampStudyPreviewWindow(parsed.data.atSeconds, totalDurationSec);
    const previewStartedAt = await claimStudyDailyVideoForPreview({
      id: video.id,
      runId,
      requestedOffsetSec: parsed.data.atSeconds,
      actualOffsetSec: window.actualOffsetSec,
      assemblyStaleBefore: new Date(Date.now() - STUDY_ASSEMBLY_STALE_MS),
      previewStaleBefore: new Date(Date.now() - STUDY_PREVIEW_STALE_MS),
    });
    if (!previewStartedAt) {
      return NextResponse.json(
        { ok: false, error: "Study video assembly or preview is already running" },
        { status: 409 },
      );
    }
    claimed = true;
    await spawnPreviewWorker(video.id, runId, paths.previewLogPath);
    return NextResponse.json(
      {
        ok: true,
        videoId: video.id,
        status: "rendering",
        requestedOffsetSec: parsed.data.atSeconds,
        actualOffsetSec: window.actualOffsetSec,
        durationSec: window.durationSec,
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (claimed) {
      await markStudyDailyVideoPreviewFailed({ id: video.id, runId, errorMessage: message });
    }
    console.error(`[study/videos/${video.id}/preview]`, message);
    return NextResponse.json({ ok: false, error: message }, { status: claimed ? 500 : 400 });
  }
}
