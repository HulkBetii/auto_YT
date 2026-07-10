import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { channelConfig } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const [row] = await db
    .select({
      workerLastSeenAt: channelConfig.workerLastSeenAt,
      workerLastStatus: channelConfig.workerLastStatus,
    })
    .from(channelConfig)
    .where(eq(channelConfig.key, "worker_heartbeat"))
    .limit(1);

  return NextResponse.json({
    workerLastSeenAt: row?.workerLastSeenAt?.toISOString() ?? null,
    workerLastStatus: row?.workerLastStatus ?? null,
  });
}
