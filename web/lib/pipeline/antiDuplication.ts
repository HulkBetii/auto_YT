import { sql } from "drizzle-orm";

import { db } from "../db";
import { listRecentVideos } from "../db/repo/videos";

const RULE_LOOKBACK_VIDEOS = 3;
const SEMANTIC_LOOKBACK_DAYS = 90;
const SEMANTIC_SIMILARITY_THRESHOLD = 0.85;

/** Layer 1 — same featured_person must not appear in the last 3 produced videos. */
export async function isPersonRepeated(featuredPerson: string): Promise<boolean> {
  if (!featuredPerson) return false;
  const recent = await listRecentVideos(RULE_LOOKBACK_VIDEOS);
  return recent.some((v) => v.featuredPerson === featuredPerson);
}

/**
 * Layer 2 — semantic similarity via pgvector cosine distance (`<=>`).
 * Drizzle has no query-builder support for the operator, so this is raw SQL;
 * the custom `vector` column type's driver format (`[0.1,0.2,...]`) is what
 * Postgres expects on the right-hand side of the cast.
 *
 * Cosine distance = 1 - cosine similarity, so "similarity > 0.85" == "distance < 0.15".
 */
export async function findSimilarRecentVideo(
  embedding: number[],
): Promise<{ id: number; title: string; similarity: number } | null> {
  const vectorLiteral = `[${embedding.join(",")}]`;
  const maxDistance = 1 - SEMANTIC_SIMILARITY_THRESHOLD;

  const result = await db.execute<{ id: number; title: string; distance: number }>(sql`
    SELECT id, title, (topic_embedding <=> ${vectorLiteral}::vector) AS distance
    FROM videos
    WHERE topic_embedding IS NOT NULL
      AND created_at > now() - (${SEMANTIC_LOOKBACK_DAYS} || ' days')::interval
      AND (topic_embedding <=> ${vectorLiteral}::vector) < ${maxDistance}
    ORDER BY distance ASC
    LIMIT 1
  `);

  const row = result.rows[0];
  if (!row) return null;
  return { id: Number(row.id), title: String(row.title), similarity: 1 - Number(row.distance) };
}

/** Combined gate — true means "reject this topic, it's a duplicate". */
export async function isDuplicateTopic(input: {
  featuredPerson: string;
  embedding: number[];
}): Promise<{ duplicate: boolean; reason?: string }> {
  if (await isPersonRepeated(input.featuredPerson)) {
    return { duplicate: true, reason: `featured_person "${input.featuredPerson}" used in last ${RULE_LOOKBACK_VIDEOS} videos` };
  }

  const similar = await findSimilarRecentVideo(input.embedding);
  if (similar) {
    return {
      duplicate: true,
      reason: `semantic similarity ${similar.similarity.toFixed(3)} with video #${similar.id} "${similar.title}"`,
    };
  }

  return { duplicate: false };
}
