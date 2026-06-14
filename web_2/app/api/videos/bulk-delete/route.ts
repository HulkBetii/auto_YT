import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { bulkDeleteAhVideos } from "@/lib/db/repo/videos";

async function assertAuth() {
  const secret = process.env.DASHBOARD_SECRET;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  return !secret || auth === secret;
}

export async function POST(req: Request) {
  if (!(await assertAuth())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  if (ids.length === 0) return NextResponse.json({ ok: false, error: "No valid IDs" }, { status: 400 });

  const count = await bulkDeleteAhVideos(ids);
  return NextResponse.json({ ok: true, deleted: count });
}
