import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteAhVideo } from "@/lib/db/repo/videos";

async function assertAuth() {
  const secret = process.env.DASHBOARD_SECRET;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  return !secret || auth === secret;
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertAuth())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const videoId = parseInt(id, 10);
  if (isNaN(videoId)) return NextResponse.json({ ok: false, error: "Invalid ID" }, { status: 400 });

  const deleted = await deleteAhVideo(videoId);
  if (!deleted) return NextResponse.json({ ok: false, error: "Video not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
