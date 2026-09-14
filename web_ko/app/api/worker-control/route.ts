import { NextResponse } from "next/server";

import { isDashboardAuthorized } from "@/lib/auth";

const CONTROL_URL = process.env.KO_CONTROL_SERVER_URL ?? "http://127.0.0.1:4243";

async function proxy(pathname: string, method: "GET" | "POST") {
  try {
    const response = await fetch(`${CONTROL_URL}${pathname}`, {
      method,
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    const body = await response.json();
    return NextResponse.json({ available: true, ...body }, { status: response.status });
  } catch (error) {
    return NextResponse.json({
      available: false,
      running: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function GET(request: Request) {
  if (!(await isDashboardAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return proxy("/status", "GET");
}

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as { action?: string };
  if (!body.action || !["start", "stop"].includes(body.action)) {
    return NextResponse.json({ ok: false, error: "action must be start or stop" }, { status: 400 });
  }
  return proxy(`/${body.action}`, "POST");
}
