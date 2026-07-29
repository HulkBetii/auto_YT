import { NextResponse } from "next/server";

import { createStudyAudioWeek } from "@/lib/db/repo/study";
import { ensureStudyWeekDirs, StudyWeekCreateSchema } from "@/lib/study/project";
import { assertStudyAuth } from "../_auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await assertStudyAuth(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = StudyWeekCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "weekNumber must be an integer from 1 to 15" }, { status: 400 });
  }

  try {
    const paths = await ensureStudyWeekDirs(parsed.data.weekNumber);
    const week = await createStudyAudioWeek(parsed.data.weekNumber);
    return NextResponse.json({ ok: true, week, paths }, { status: 201 });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "23505") {
      return NextResponse.json({ ok: false, error: "Study audio week already exists" }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[study/weeks]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
