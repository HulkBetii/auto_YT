import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { runDrChainCycle } from "@/lib/pipeline/chain";

export const maxDuration = 300;

export async function POST() {
  const secret = process.env.DASHBOARD_SECRET;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;

  if (secret && auth !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDrChainCycle();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[jobs/process-now]", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
