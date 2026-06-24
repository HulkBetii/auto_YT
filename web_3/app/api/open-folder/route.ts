import { execFile } from "node:child_process";
import { stat, mkdir } from "node:fs/promises";
import { promisify } from "node:util";

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

const BodySchema = z.object({
  path: z.string().min(1),
});

const allowedOrigins = new Set([
  "https://web3-bay-zeta.vercel.app",
  "http://localhost:3000",
  "http://localhost:3002",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3002",
]);

function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.has(origin)) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

export async function POST(request: NextRequest) {
  if (!(await assertAuth(request))) {
    return json(request, { ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (process.platform !== "darwin") {
    return json(
      request,
      { ok: false, error: "Open in folder is only available on a local macOS server." },
      { status: 501 },
    );
  }

  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return json(request, { ok: false, error: "Invalid body" }, { status: 400 });
  }

  try {
    const targetPath = body.data.path;
    await mkdir(targetPath, { recursive: true });
    const stats = await stat(targetPath);
    if (!stats.isDirectory()) {
      return json(request, { ok: false, error: "Path exists but is not a directory" }, { status: 400 });
    }

    await execFileAsync("open", [targetPath]);
    return json(request, { ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return json(request, { ok: false, error: msg }, { status: 500 });
  }
}
