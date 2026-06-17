import { NextRequest, NextResponse } from "next/server";
import { setAhConfigValue, getAhConfigValue } from "@/lib/db/repo/channel-config";

export const dynamic = "force-dynamic";

function assertAuth(request: NextRequest): boolean {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!assertAuth(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as {
    tool_online?: boolean;
    imagen_error_at?: string;
  };

  await setAhConfigValue("worker_last_seen", new Date().toISOString());

  if (body.tool_online !== undefined) {
    await setAhConfigValue(
      "tool_last_active",
      body.tool_online ? new Date().toISOString() : "offline",
    );
  }
  if (body.imagen_error_at) {
    await setAhConfigValue("imagen_last_error", body.imagen_error_at);
  }

  const [workerPaused, toolPaused] = await Promise.all([
    getAhConfigValue("worker_paused").then((v) => v === "true"),
    getAhConfigValue("tool_paused").then((v) => v === "true"),
  ]);
  return NextResponse.json({ ok: true, workerPaused, toolPaused });
}
