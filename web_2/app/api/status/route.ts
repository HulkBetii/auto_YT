import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAllAhConfig } from "@/lib/db/repo/channel-config";

export const dynamic = "force-dynamic";

async function assertAuth() {
  const secret = process.env.DASHBOARD_SECRET;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  const bearer = (await Promise.resolve(null)) as null; // satisfy TS
  void bearer;
  return !secret || auth === secret;
}

export async function GET() {
  if (!(await assertAuth())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const config = await getAllAhConfig();

  const workerLastSeen = config["worker_last_seen"] ?? null;
  const cronLastRunAt = config["cron_last_run_at"] ?? null;
  const pipelinePaused = config["pipeline_paused"] === "true";

  const now = Date.now();
  const workerAgeMs = workerLastSeen ? now - new Date(workerLastSeen).getTime() : Infinity;
  const cronAgeMs = cronLastRunAt ? now - new Date(cronLastRunAt).getTime() : Infinity;

  // Worker: online if heartbeat < 3 min ago
  const workerOnline = workerAgeMs < 3 * 60 * 1000;
  // Cron: active if last run < 5 min ago
  const cronActive = cronAgeMs < 5 * 60 * 1000;

  return NextResponse.json({
    ok: true,
    worker: { online: workerOnline, lastSeen: workerLastSeen, ageMs: isFinite(workerAgeMs) ? workerAgeMs : null },
    cron: { active: cronActive, lastRun: cronLastRunAt, ageMs: isFinite(cronAgeMs) ? cronAgeMs : null },
    pipeline: { paused: pipelinePaused },
  });
}

export async function POST(request: Request) {
  if (!(await assertAuth())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { setAhConfigValue } = await import("@/lib/db/repo/channel-config");
  const body = (await request.json()) as { pipeline_paused?: boolean };

  if (typeof body.pipeline_paused === "boolean") {
    await setAhConfigValue("pipeline_paused", body.pipeline_paused ? "true" : "false");
  }

  return NextResponse.json({ ok: true });
}
