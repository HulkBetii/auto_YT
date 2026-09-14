import { NextResponse } from "next/server";

import { isDashboardAuthorized } from "@/lib/auth";
import { runKoChainCycle } from "@/lib/pipeline/chain";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runKoChainCycle()) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
