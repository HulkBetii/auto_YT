import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getRunVeoWatcherStatus,
  startRunVeoWatcher,
  stopRunVeoWatcher,
} from "@/lib/run-veo-watcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  action: z.enum(["start", "stop"]),
});

const allowedOrigins = new Set([
  "https://web2-blue-chi.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
]);

function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.has(origin)) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(request: NextRequest, body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...getCorsHeaders(request),
      ...init?.headers,
    },
  });
}

function isAllowedCorsRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && allowedOrigins.has(origin));
}

async function assertAuth(request: NextRequest): Promise<boolean> {
  if (isAllowedCorsRequest(request)) return true;

  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return true;

  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  const bearer = request.headers.get("authorization");
  return auth === secret || bearer === `Bearer ${secret}`;
}

export async function OPTIONS(request: NextRequest) {
  if (!isAllowedCorsRequest(request)) {
    return json(request, { ok: false, error: "Origin not allowed" }, { status: 403 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

export async function GET(request: NextRequest) {
  if (!(await assertAuth(request))) {
    return json(request, { ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return json(request, { ok: true, watcher: await getRunVeoWatcherStatus() });
}

export async function POST(request: NextRequest) {
  if (!(await assertAuth(request))) {
    return json(request, { ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return json(request, { ok: false, error: "Invalid body" }, { status: 400 });
  }

  const watcher =
    body.data.action === "start"
      ? await startRunVeoWatcher()
      : await stopRunVeoWatcher();

  return json(request, { ok: true, watcher });
}
