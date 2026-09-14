import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { koJpJobs, type KoJpJob } from "@/lib/db/schema";

export async function createKoJpJob(data: {
  videoId: number;
  sectionId?: number | null;
  stage: string;
  modelLabel?: string;
  effort?: string;
  promptText: string;
  promptVersionId: number;
  promptSnapshot: string;
  causedByJobId?: number | null;
  metadata?: Record<string, unknown> | null;
}): Promise<KoJpJob> {
  const [inserted] = await db.insert(koJpJobs).values(data).returning();
  return inserted;
}

export async function getKoJpJob(id: number): Promise<KoJpJob | null> {
  const [row] = await db.select().from(koJpJobs).where(eq(koJpJobs.id, id)).limit(1);
  return row ?? null;
}

export async function listRecentKoJpJobs(limit = 20): Promise<KoJpJob[]> {
  return db.select().from(koJpJobs).orderBy(desc(koJpJobs.createdAt)).limit(limit);
}

export async function findJobByCause(
  causedByJobId: number,
  stage: string,
  videoId: number,
): Promise<KoJpJob | null> {
  const [row] = await db
    .select()
    .from(koJpJobs)
    .where(
      and(
        eq(koJpJobs.causedByJobId, causedByJobId),
        eq(koJpJobs.stage, stage),
        eq(koJpJobs.videoId, videoId),
      ),
    )
    .limit(1);
  return row ?? null;
}
