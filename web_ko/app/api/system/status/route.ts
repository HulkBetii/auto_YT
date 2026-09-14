import { NextResponse } from "next/server";

import { isDashboardAuthorized } from "@/lib/auth";
import { getAllKoConfig, KO_CONFIG_KEYS } from "@/lib/db/repo/config";
import { getKoQueueCounts } from "@/lib/db/repo/jobs";
import { getYtProMaxHealth } from "@/lib/pipeline/yt-pro-max";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isDashboardAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const [config, queue, ytProMax] = await Promise.all([
    getAllKoConfig(),
    getKoQueueCounts(),
    getYtProMaxHealth(),
  ]);
  const lastSeen = config[KO_CONFIG_KEYS.workerLastSeen] ?? null;
  const ageMs = lastSeen ? Date.now() - new Date(lastSeen).getTime() : null;
  return NextResponse.json({
    ok: true,
    worker: {
      online: ageMs != null && ageMs < 60_000,
      state: config[KO_CONFIG_KEYS.workerState] ?? "offline",
      error: config[KO_CONFIG_KEYS.workerError] || null,
      profileLocked: config[KO_CONFIG_KEYS.profileLocked] === "true",
      lastSeen,
      ageMs,
    },
    queue,
    ytProMax,
    chainLastRunAt: config[KO_CONFIG_KEYS.chainLastRunAt] ?? null,
  });
}
