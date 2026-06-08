import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";

/** Resets a hard-failed job back to pending so the worker picks it up again. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number.parseInt(id, 10);
  if (!Number.isFinite(jobId)) return NextResponse.json({ ok: false, error: "ID job không hợp lệ" }, { status: 400 });

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return NextResponse.json({ ok: false, error: "Không tìm thấy job" }, { status: 404 });
  if (job.status !== "failed") {
    return NextResponse.json({ ok: false, error: "Chỉ có thể thử lại các job đã thất bại từ đây" }, { status: 400 });
  }

  await db
    .update(jobs)
    .set({ status: "pending", retryCount: 0, errorMessage: null, startedAt: null, finishedAt: null })
    .where(eq(jobs.id, jobId));

  return NextResponse.json({ ok: true });
}
