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
  const workerPaused = config["worker_paused"] === "true";
  const toolPaused = config["tool_paused"] === "true";
  const toolLastActive = config["tool_last_active"] ?? null;
  const imagenLastError = config["imagen_last_error"] ?? null;

  const now = Date.now();
  const workerAgeMs = workerLastSeen ? now - new Date(workerLastSeen).getTime() : Infinity;
  const cronAgeMs = cronLastRunAt ? now - new Date(cronLastRunAt).getTime() : Infinity;
  const toolAgeMs =
    toolLastActive && toolLastActive !== "offline"
      ? now - new Date(toolLastActive).getTime()
      : Infinity;
  const imagenErrorAgeMs = imagenLastError
    ? now - new Date(imagenLastError).getTime()
    : Infinity;

  // Worker: online if heartbeat < 3 min ago
  const workerOnline = workerAgeMs < 3 * 60 * 1000;
  // Cron: active if last run < 5 min ago
  const cronActive = cronAgeMs < 5 * 60 * 1000;
  // VEO Tool: online if last active < 3 min ago (and not explicitly "offline")
  const toolOnline = toolLastActive !== "offline" && toolAgeMs < 3 * 60 * 1000;
  // Google Imagen: quota ok if no error in last 30 min (or never had error)
  const imagenQuotaOk = imagenErrorAgeMs > 30 * 60 * 1000;

  return NextResponse.json({
    ok: true,
    worker: { online: workerOnline, paused: workerPaused, lastSeen: workerLastSeen, ageMs: isFinite(workerAgeMs) ? workerAgeMs : null },
    cron: { active: cronActive, lastRun: cronLastRunAt, ageMs: isFinite(cronAgeMs) ? cronAgeMs : null },
    pipeline: { paused: pipelinePaused },
    tool: { online: toolOnline, paused: toolPaused, lastActive: toolLastActive, ageMs: isFinite(toolAgeMs) ? toolAgeMs : null },
    imagen: { quotaOk: imagenQuotaOk, lastError: imagenLastError, ageMs: isFinite(imagenErrorAgeMs) ? imagenErrorAgeMs : null },
  });
}

export async function POST(request: Request) {
  if (!(await assertAuth())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { setAhConfigValue } = await import("@/lib/db/repo/channel-config");
  const body = (await request.json()) as {
    pipeline_paused?: boolean;
    worker_paused?: boolean;
    tool_paused?: boolean;
    reset_imagen_error?: boolean;
  };

  if (typeof body.pipeline_paused === "boolean") {
    await setAhConfigValue("pipeline_paused", body.pipeline_paused ? "true" : "false");
  }
  if (typeof body.worker_paused === "boolean") {
    await setAhConfigValue("worker_paused", body.worker_paused ? "true" : "false");
  }
  if (typeof body.tool_paused === "boolean") {
    await setAhConfigValue("tool_paused", body.tool_paused ? "true" : "false");
  }
  if (body.reset_imagen_error) {
    await setAhConfigValue("imagen_last_error", "");
  }

  return NextResponse.json({ ok: true });
}
