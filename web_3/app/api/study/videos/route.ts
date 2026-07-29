import { NextResponse } from "next/server";

import {
  createStudyDailyVideo,
  getStudyAudioWeekByNumber,
} from "@/lib/db/repo/study";
import {
  ensureStudyDayDirs,
  StudyVideoCreateSchema,
  weekNumberForDay,
} from "@/lib/study/project";
import { assertStudyAuth } from "../_auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await assertStudyAuth(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = StudyVideoCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "dayNumber must be an integer from 1 to 100" }, { status: 400 });
  }

  try {
    const weekNumber = weekNumberForDay(parsed.data.dayNumber);
    const week = await getStudyAudioWeekByNumber(weekNumber);
    if (!week) {
      return NextResponse.json(
        { ok: false, error: `Create study audio week ${weekNumber} first` },
        { status: 409 },
      );
    }
    const paths = await ensureStudyDayDirs(parsed.data.dayNumber);
    const video = await createStudyDailyVideo(parsed.data.dayNumber, week.id);
    return NextResponse.json({ ok: true, video, paths }, { status: 201 });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "23505") {
      return NextResponse.json({ ok: false, error: "Study daily video already exists" }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[study/videos]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
