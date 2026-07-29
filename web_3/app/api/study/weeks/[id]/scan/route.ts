import { NextResponse } from "next/server";

import {
  getStudyAudioWeek,
  markStudyAudioWeekFailed,
  updateStudyAudioWeekScan,
} from "@/lib/db/repo/study";
import { scanStudyAudioTracks } from "@/lib/study/media";
import { getStudyWeekPaths, StudyWeekScanSchema } from "@/lib/study/project";
import { assertStudyAuth } from "../../../_auth";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertStudyAuth(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const weekId = Number(id);
  if (!Number.isInteger(weekId) || weekId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid study audio week ID" }, { status: 400 });
  }
  const parsed = StudyWeekScanSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const week = await getStudyAudioWeek(weekId);
  if (!week) return NextResponse.json({ ok: false, error: "Study audio week not found" }, { status: 404 });
  if (week.status === "generating") {
    return NextResponse.json(
      { ok: false, error: "Study music generation must finish before scanning" },
      { status: 409 },
    );
  }

  try {
    const paths = getStudyWeekPaths(week.weekNumber);
    const trackManifest = await scanStudyAudioTracks(paths.audioDir, paths.mediaRoot);
    const totalDurationSec = Math.round(
      trackManifest.files.reduce((total, track) => total + track.durationSec, 0),
    );
    const rightsVerifiedAt = parsed.data.confirmCommercialRights ? new Date() : null;
    const updated = await updateStudyAudioWeekScan({
      id: week.id,
      trackManifest,
      totalDurationSec,
      rightsVerifiedAt,
    });
    return NextResponse.json({ ok: true, week: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markStudyAudioWeekFailed(week.id, message);
    console.error(`[study/weeks/${week.id}/scan]`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
