import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { videoAnalytics, videoContent, jobs, videos } from "@/lib/db/schema";
import { removeRenderArtifacts } from "@/lib/render/files";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { ids?: unknown };
  const ids = body.ids;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
  }
  const numIds = [...new Set(ids.map(Number))];
  if (
    numIds.some((videoId) => !Number.isSafeInteger(videoId) || videoId <= 0)
  ) {
    return NextResponse.json({ error: "ids must contain positive integers" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: videos.id, renderStatus: videos.renderStatus })
      .from(videos)
      .where(inArray(videos.id, numIds))
      .for("update");
    const renderingIds = rows
      .filter((row) => row.renderStatus === "rendering")
      .map((row) => row.id);
    if (renderingIds.length > 0) {
      return { renderingIds, deleted: [] };
    }

    await tx.delete(videoAnalytics).where(inArray(videoAnalytics.videoId, numIds));
    await tx.delete(videoContent).where(inArray(videoContent.videoId, numIds));
    await tx.delete(jobs).where(inArray(jobs.videoId, numIds));
    const deleted = await tx
      .delete(videos)
      .where(inArray(videos.id, numIds))
      .returning({ id: videos.id });
    return { renderingIds: [], deleted };
  });
  if (result.renderingIds.length > 0) {
    return NextResponse.json(
      { error: "Cannot delete videos while rendering", ids: result.renderingIds },
      { status: 409 },
    );
  }

  const cleanup = await Promise.allSettled(
    result.deleted.map((row) => removeRenderArtifacts(row.id)),
  );
  const cleanupWarnings = cleanup.flatMap((cleanupResult, index) =>
    cleanupResult.status === "rejected"
      ? [{ id: result.deleted[index].id, error: String(cleanupResult.reason) }]
      : [],
  );

  return NextResponse.json({
    deleted: result.deleted.length,
    ids: result.deleted.map((row) => row.id),
    cleanupWarnings,
  });
}
