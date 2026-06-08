import { NextResponse } from "next/server";

import { setConfigValue } from "@/lib/db/repo/channel-config";

export async function POST() {
  await setConfigValue("auto_update_paused", "false");
  return NextResponse.json({ ok: true });
}
