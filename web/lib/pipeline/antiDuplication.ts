import { sql } from "drizzle-orm";

import { db } from "../db";
import { getConfigValue } from "../db/repo/channel-config";
import { listRecentVideos } from "../db/repo/videos";

// ── Configurable defaults (overridden by channel_config) ─────────────────────
const DEFAULT_PERSON_LOOKBACK = 3;       // anti_dup_person_lookback
const DEFAULT_PAIN_LOOKBACK = 6;         // anti_dup_pain_lookback
const DEFAULT_SEMANTIC_DAYS = 90;        // anti_dup_semantic_days
const DEFAULT_SIMILARITY_THRESHOLD = 85; // anti_dup_similarity_threshold (0-100)

async function configInt(key: string, fallback: number): Promise<number> {
  const raw = await getConfigValue(key);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalize a person name string for comparison:
 * - trim leading/trailing whitespace
 * - collapse internal whitespace to single space
 * - normalize to NFC (handles full-width / half-width variants)
 * This prevents LLM output like "田中 角栄" (extra space) bypassing the check.
 */
function normalizeName(name: string): string {
  return name.trim().normalize("NFC").replace(/\s+/g, " ");
}

/**
 * Layer 1a — same featured_person must not appear in the last N produced videos.
 * N is configurable via `anti_dup_person_lookback` (default 3).
 */
export async function isPersonRepeated(featuredPerson: string, lookback?: number): Promise<boolean> {
  if (!featuredPerson) return false;
  const count = lookback ?? await configInt("anti_dup_person_lookback", DEFAULT_PERSON_LOOKBACK);
  const recent = await listRecentVideos(count);
  const normalized = normalizeName(featuredPerson);
  return recent.some(
    (v) => v.featuredPerson != null && normalizeName(v.featuredPerson) === normalized,
  );
}

/**
 * Layer 1b — same (featured_person + pain_type) combo must not appear in the
 * last N produced videos. Prevents same character recycling the same emotional
 * hook (e.g. 田中角栄 × Pain-A twice in 6 videos).
 * N is configurable via `anti_dup_pain_lookback` (default 6).
 */
export async function isPersonPainRepeated(
  featuredPerson: string,
  painType: string,
  lookback?: number,
): Promise<boolean> {
  if (!featuredPerson || !painType) return false;
  const count = lookback ?? await configInt("anti_dup_pain_lookback", DEFAULT_PAIN_LOOKBACK);
  const recent = await listRecentVideos(count);
  const normalizedPerson = normalizeName(featuredPerson);
  return recent.some(
    (v) =>
      v.featuredPerson != null &&
      normalizeName(v.featuredPerson) === normalizedPerson &&
      v.painType === painType,
  );
}

/**
 * Layer 2 — semantic similarity via pgvector cosine distance (`<=>`).
 * Drizzle has no query-builder support for the operator, so this is raw SQL;
 * the custom `vector` column type's driver format (`[0.1,0.2,...]`) is what
 * Postgres expects on the right-hand side of the cast.
 *
 * Cosine distance = 1 - cosine similarity, so "similarity > 0.85" == "distance < 0.15".
 * Both the lookback window (days) and threshold are configurable via channel_config.
 */
export async function findSimilarRecentVideo(
  embedding: number[],
): Promise<{ id: number; title: string; similarity: number } | null> {
  const [semanticDays, similarityPct] = await Promise.all([
    configInt("anti_dup_semantic_days", DEFAULT_SEMANTIC_DAYS),
    configInt("anti_dup_similarity_threshold", DEFAULT_SIMILARITY_THRESHOLD),
  ]);
  const threshold = similarityPct / 100;
  const vectorLiteral = `[${embedding.join(",")}]`;
  const maxDistance = 1 - threshold;

  const result = await db.execute<{ id: number; title: string; distance: number }>(sql`
    SELECT id, title, (topic_embedding <=> ${vectorLiteral}::vector) AS distance
    FROM videos
    WHERE topic_embedding IS NOT NULL
      AND created_at > now() - (${semanticDays} || ' days')::interval
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
  painType: string;
  embedding: number[];
}): Promise<{ duplicate: boolean; reason?: string }> {
  // Fetch once and pass to sub-functions to avoid duplicate DB round-trips.
  const [lookback, painLookback] = await Promise.all([
    configInt("anti_dup_person_lookback", DEFAULT_PERSON_LOOKBACK),
    configInt("anti_dup_pain_lookback", DEFAULT_PAIN_LOOKBACK),
  ]);

  if (await isPersonRepeated(input.featuredPerson, lookback)) {
    return {
      duplicate: true,
      reason: `featured_person "${input.featuredPerson}" used in last ${lookback} videos`,
    };
  }

  if (await isPersonPainRepeated(input.featuredPerson, input.painType, painLookback)) {
    return {
      duplicate: true,
      reason: `"${input.featuredPerson}" × pain_type "${input.painType}" combo used in last ${painLookback} videos`,
    };
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
