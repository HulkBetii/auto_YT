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
  };

  await setAhConfigValue("run_veo_watcher_last_seen", new Date().toISOString());

  if (body.tool_online !== undefined) {
    await setAhConfigValue(
      "run_veo_tool_last_active",
      body.tool_online ? new Date().toISOString() : "offline",
    );
  }

  const [watcherPaused, toolPaused] = await Promise.all([
    getAhConfigValue("run_veo_watcher_paused").then((v) => v === "true"),
    getAhConfigValue("tool_paused").then((v) => v === "true"),
  ]);
  return NextResponse.json({ ok: true, workerPaused: watcherPaused, toolPaused });
}
