import { sql } from "drizzle-orm";

import { db } from "../db";
import { getConfigValue } from "../db/repo/channel-config";
import { listRecentVideos } from "../db/repo/videos";

const DEFAULT_SEMANTIC_DAYS = 90;
const DEFAULT_SIMILARITY_THRESHOLD = 85;
const DEFAULT_FATIGUE_LOOKBACK = 12;
const DEFAULT_ARCHETYPE_WINDOW = 3;
const DEFAULT_LIST_COUNT_WINDOW = 3;

const TITLE_PREFIX_RE = /^【[^】]+】/;
const LIST_COUNT_RE = /[一二三四五六七八九十0-9]+(つ|個|選|項目|習慣|特徴|理由|サイン|兆候|方法|こと)/g;
const STRONG_NUMBER_RE = /(9割|九割|99%|九九%|ほとんどの人|絶対|一生|人生終わり|恐ろしい|警告|危険|後悔|崩壊|貧乏)/g;
const PARTICLE_RE = /(この|その|あの|実は|本当の|意外な|知らない|気づいていない|人|方|あなた|わたし|私|です|ます|する|しない|だけ|なぜ|理由|特徴|サイン|兆候|方法|真実|秘密)/g;

async function configInt(key: string, fallback: number): Promise<number> {
  const raw = await getConfigValue(key);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeDupText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(TITLE_PREFIX_RE, "")
    .replace(/[「」『』【】［］\[\]（）()、。！？!?・…,.:\s\-—]/g, "")
    .trim();
}

export function titleSkeleton(title: string): string {
  return normalizeDupText(title)
    .replace(LIST_COUNT_RE, "N")
    .replace(STRONG_NUMBER_RE, "X")
    .replace(/[0-9]+/g, "N")
    .replace(PARTICLE_RE, "")
    .slice(0, 40);
}

function fearSignature(title: string, hookType?: string): string {
  const normalized = normalizeDupText(`${hookType ?? ""}${title}`);
  const hits = Array.from(normalized.matchAll(STRONG_NUMBER_RE)).map((m) => m[0]);
  if (hookType === "DIRECT_WARNING" || hookType === "FUTURE_REGRET") hits.push(hookType);
  return [...new Set(hits)].join("|");
}

function isSamePromise(a: string, b: string): boolean {
  const normalizedA = normalizeDupText(a);
  const normalizedB = normalizeDupText(b);
  if (!normalizedA || !normalizedB) return false;
  return normalizedA === normalizedB || normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA);
}

function findRecentFatigue(
  input: {
    topic: string;
    title: string;
    contentArchetype?: string;
    listCount?: number | null;
    corePromise?: string;
    hookType?: string;
  },
  recent: Awaited<ReturnType<typeof listRecentVideos>>,
): string | null {
  const normalizedTitle = normalizeDupText(input.title);
  const normalizedTopic = normalizeDupText(input.topic);
  const skeleton = titleSkeleton(input.title);
  const fear = fearSignature(input.title, input.hookType);

  const exact = recent.find((v) => {
    const recentTitle = normalizeDupText(v.title);
    const recentPromise = normalizeDupText(v.corePromise);
    return (
      (normalizedTitle && recentTitle === normalizedTitle) ||
      (normalizedTopic && recentTitle === normalizedTopic) ||
      isSamePromise(input.corePromise ?? "", recentPromise)
    );
  });
  if (exact) return `exact or promise duplicate with video #${exact.id} "${exact.title}"`;

  const skeletonMatch = recent.find(
    (v) =>
      skeleton &&
      titleSkeleton(v.title) === skeleton &&
      (!input.contentArchetype || !v.contentArchetype || v.contentArchetype === input.contentArchetype),
  );
  if (skeletonMatch) return `title skeleton fatigue with video #${skeletonMatch.id} "${skeletonMatch.title}"`;

  if (input.contentArchetype) {
    const sameArchetype = recent
      .slice(0, DEFAULT_ARCHETYPE_WINDOW)
      .filter((v) => v.contentArchetype === input.contentArchetype);
    if (sameArchetype.length >= DEFAULT_ARCHETYPE_WINDOW) {
      return `archetype "${input.contentArchetype}" used in last ${DEFAULT_ARCHETYPE_WINDOW} videos`;
    }
  }

  if (input.listCount && input.listCount > 0) {
    const sameListCount = recent
      .slice(0, DEFAULT_LIST_COUNT_WINDOW)
      .filter((v) => v.listCount === input.listCount);
    if (sameListCount.length >= DEFAULT_LIST_COUNT_WINDOW) {
      return `list_count ${input.listCount} repeated in last ${DEFAULT_LIST_COUNT_WINDOW} videos`;
    }
  }

  if (fear) {
    const sameFear = recent
      .slice(0, 4)
      .filter((v) => fearSignature(v.title, v.hookType ?? undefined) === fear);
    if (sameFear.length >= 2) return `fear trigger "${fear}" is already dense in recent videos`;
  }

  return null;
}

/**
 * Semantic similarity via pgvector cosine distance (`<=>`).
 * Cosine distance = 1 - cosine similarity, so "similarity > 0.85" == "distance < 0.15".
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

/** Combined gate: true means reject this topic as duplicate/fatigued. */
export async function isDuplicateTopic(input: {
  featuredPerson?: string;
  painType?: string;
  topic: string;
  title: string;
  contentArchetype?: string;
  listCount?: number | null;
  corePromise?: string;
  hookType?: string;
  embedding: number[];
}): Promise<{ duplicate: boolean; reason?: string }> {
  const fatigueLookback = await configInt("anti_dup_fatigue_lookback", DEFAULT_FATIGUE_LOOKBACK);
  const recent = await listRecentVideos(fatigueLookback);
  const fatigueReason = findRecentFatigue(input, recent);
  if (fatigueReason) return { duplicate: true, reason: fatigueReason };

  const similar = await findSimilarRecentVideo(input.embedding);
  if (similar) {
    return {
      duplicate: true,
      reason: `semantic similarity ${similar.similarity.toFixed(3)} with video #${similar.id} "${similar.title}"`,
    };
  }

  return { duplicate: false };
}
