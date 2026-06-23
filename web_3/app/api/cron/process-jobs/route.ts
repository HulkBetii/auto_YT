import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/utils/auth";
import { runDrChainCycle } from "@/lib/pipeline/chain";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDrChainCycle();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[cron/process-jobs]", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDrChainCycle();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[cron/process-jobs]", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
