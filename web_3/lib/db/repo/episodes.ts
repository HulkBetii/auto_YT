import { and, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "../index";
import {
  drEpisodes,
  type DrEpisodeStatus,
  type SceneInput,
  IN_PIPELINE_STATUSES,
} from "../schema";

export interface RecentSceneSummary {
  id: number;
  status: string;
  sceneName: string | null;
  musicRole: string | null;
}

function getSceneField(value: unknown, field: keyof SceneInput): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = (value as Record<string, unknown>)[field];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function createDrEpisode(input: typeof drEpisodes.$inferInsert) {
  const [created] = await db.insert(drEpisodes).values(input).returning();
  return created;
}

export async function getDrEpisode(episodeId: number) {
  const [row] = await db.select().from(drEpisodes).where(eq(drEpisodes.id, episodeId)).limit(1);
  return row ?? null;
}

export async function listDrEpisodes(
  filter?: { status?: DrEpisodeStatus; published?: boolean },
  limit = 30,
) {
  let q = db.select().from(drEpisodes).$dynamic();
  if (filter?.status) {
    q = q.where(eq(drEpisodes.status, filter.status));
  } else if (filter?.published) {
    q = q.where(sql`${drEpisodes.publishedAt} IS NOT NULL`);
  }
  return q.orderBy(desc(drEpisodes.createdAt)).limit(limit);
}

export async function listRecentSceneSummaries(
  limit = 30,
  excludeEpisodeId?: number,
): Promise<RecentSceneSummary[]> {
  const rows = await db
    .select({
      id: drEpisodes.id,
      status: drEpisodes.status,
      sceneInput: drEpisodes.sceneInput,
    })
    .from(drEpisodes)
    .orderBy(desc(drEpisodes.createdAt))
    .limit(excludeEpisodeId ? limit + 1 : limit);

  return rows
    .filter((row) => row.id !== excludeEpisodeId)
    .map((row) => ({
      id: row.id,
      status: row.status,
      sceneName: getSceneField(row.sceneInput, "scene_name"),
      musicRole: getSceneField(row.sceneInput, "music_role"),
    }))
    .filter((row) => row.sceneName)
    .slice(0, limit);
}

export function formatRecentScenesForPrompt(recentScenes: RecentSceneSummary[]): string {
  if (recentScenes.length === 0) return "No previous scenes yet.";

  return recentScenes
    .map((scene, index) => {
      const role = scene.musicRole ? ` [${scene.musicRole}]` : "";
      return `${index + 1}. ${scene.sceneName}${role}`;
    })
    .join("\n");
}

export async function updateDrEpisodeStatus(episodeId: number, status: DrEpisodeStatus) {
  await db
    .update(drEpisodes)
    .set({ status, updatedAt: new Date() })
    .where(eq(drEpisodes.id, episodeId));
}

export async function updateDrEpisodeFields(
  episodeId: number,
  fields: Partial<typeof drEpisodes.$inferInsert>,
) {
  await db
    .update(drEpisodes)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(drEpisodes.id, episodeId));
}

export async function countDrEpisodesByStatus(): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: drEpisodes.status, n: count() })
    .from(drEpisodes)
    .groupBy(drEpisodes.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export async function listInPipelineDrEpisodes() {
  return db
    .select()
    .from(drEpisodes)
    .where(inArray(drEpisodes.status, IN_PIPELINE_STATUSES))
    .orderBy(desc(drEpisodes.createdAt));
}

/**
 * Acquires a short lease so only one cron cycle drives the Suno fan-out for an
 * episode at a time. Succeeds if no live lease exists (NULL or older than the
 * lease window). Returns true if this caller won the lease.
 */
export async function claimEpisodeForSuno(
  episodeId: number,
  leaseMs: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - leaseMs);
  const result = await db
    .update(drEpisodes)
    .set({ sunoLock: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(drEpisodes.id, episodeId),
        or(isNull(drEpisodes.sunoLock), lt(drEpisodes.sunoLock, cutoff)),
      ),
    )
    .returning({ id: drEpisodes.id });
  return result.length > 0;
}

export async function releaseEpisodeSunoLock(episodeId: number): Promise<void> {
  await db
    .update(drEpisodes)
    .set({ sunoLock: null })
    .where(eq(drEpisodes.id, episodeId));
}

export async function listNeedsAttentionDrEpisodes() {
  return db
    .select()
    .from(drEpisodes)
    .where(eq(drEpisodes.status, "needs_attention"))
    .orderBy(desc(drEpisodes.updatedAt));
}

export async function listReadyDrEpisodes(limit = 10) {
  return db
    .select()
    .from(drEpisodes)
    .where(eq(drEpisodes.status, "ready"))
    .orderBy(desc(drEpisodes.updatedAt))
    .limit(limit);
}

export async function deleteDrEpisode(episodeId: number) {
  await db.execute(sql`DELETE FROM dr_jobs WHERE episode_id = ${episodeId}`);
  const [deleted] = await db
    .delete(drEpisodes)
    .where(eq(drEpisodes.id, episodeId))
    .returning({ id: drEpisodes.id });
  return deleted ?? null;
}

export async function bulkDeleteDrEpisodes(episodeIds: number[]) {
  if (episodeIds.length === 0) return 0;
  await db.execute(sql`DELETE FROM dr_jobs WHERE episode_id = ANY(${episodeIds}::int[])`);
  const deleted = await db
    .delete(drEpisodes)
    .where(inArray(drEpisodes.id, episodeIds))
    .returning({ id: drEpisodes.id });
  return deleted.length;
}
