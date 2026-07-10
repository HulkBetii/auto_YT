import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  path: z.string().min(1),
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function openFolderCommand(targetPath: string, revealFile = false): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return revealFile
      ? { command: "explorer.exe", args: [`/select,${targetPath}`] }
      : { command: "explorer.exe", args: [targetPath] };
  }
  if (process.platform === "darwin") {
    return revealFile
      ? { command: "open", args: ["-R", targetPath] }
      : { command: "open", args: [targetPath] };
  }
  return { command: "xdg-open", args: [revealFile ? path.dirname(targetPath) : targetPath] };
}

function launchFolderCommand(opener: { command: string; args: string[] }) {
  const child = spawn(opener.command, opener.args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
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

  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return json(request, { ok: false, error: "Invalid body" }, { status: 400 });
  }

  const targetPath = body.data.path;
  if (targetPath.includes("\0") || !path.isAbsolute(targetPath)) {
    return json(request, { ok: false, error: "Invalid path" }, { status: 400 });
  }

  let openPath = targetPath;
  let revealFile = false;

  try {
    const targetStat = await stat(targetPath);
    revealFile = !targetStat.isDirectory();
  } catch {
    const parentPath = path.dirname(targetPath);

    try {
      const parentStat = await stat(parentPath);
      if (!parentStat.isDirectory()) throw new Error("Parent path is not a directory.");
      openPath = parentPath;
    } catch {
      return json(request, { ok: false, error: "Folder not found" }, { status: 404 });
    }
  }

  try {
    launchFolderCommand(openFolderCommand(openPath, revealFile));
    return json(request, { ok: true });
  } catch {
    return json(request, { ok: false, error: "Failed to open folder" }, { status: 500 });
  }
}

