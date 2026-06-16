import { NextRequest, NextResponse } from "next/server";
import { setAhConfigValue } from "@/lib/db/repo/channel-config";

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

  await setAhConfigValue("worker_last_seen", new Date().toISOString());
  return NextResponse.json({ ok: true });
}
