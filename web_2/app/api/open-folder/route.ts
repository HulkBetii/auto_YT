import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
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

async function assertAuth(request: NextRequest): Promise<boolean> {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return true;

  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  const bearer = request.headers.get("authorization");
  return auth === secret || bearer === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!(await assertAuth(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (process.platform !== "darwin") {
    return NextResponse.json(
      { ok: false, error: "Open in folder is only available on a local macOS server." },
      { status: 501 },
    );
  }

  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const targetPath = body.data.path;
  if (targetPath.includes("\0") || !path.isAbsolute(targetPath)) {
    return NextResponse.json({ ok: false, error: "Invalid path" }, { status: 400 });
  }

  try {
    const targetStat = await stat(targetPath);
    const args = targetStat.isDirectory() ? [targetPath] : ["-R", targetPath];
    await execFileAsync("open", args);
    return NextResponse.json({ ok: true });
  } catch {
    const parentPath = path.dirname(targetPath);
    try {
      const parentStat = await stat(parentPath);
      if (!parentStat.isDirectory()) throw new Error("Parent path is not a directory.");
      await execFileAsync("open", [parentPath]);
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ ok: false, error: "Path not found" }, { status: 404 });
    }
  }
}
