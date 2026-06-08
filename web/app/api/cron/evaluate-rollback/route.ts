import { and, desc, eq, gte, lt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getConfigValue, setConfigValue } from "@/lib/db/repo/channel-config";
import { activateNewPromptVersion } from "@/lib/db/repo/prompt-versions";
import { getLatestAnalytics } from "@/lib/db/repo/video-analytics";
import { promptVersions, videos } from "@/lib/db/schema";
import { logEvent } from "@/lib/observability/log";
import { notify } from "@/lib/notifications";

export const maxDuration = 120;

const ROLLBACK_LIMIT_PER_30_DAYS = 1;
const ROLLBACK_WINDOW_DAYS = 30;

/**
 * Rolling 30-day rollback counter, stored as plain channel_config key/value
 * pairs (`rollback_count_30d` + `rollback_window_started_at`) rather than the
 * generic `rollback_count_30d` column on the table — that column is per-row,
 * not per-prompt-key, and P6 only ever rewrites P1, so a single global counter
 * with an explicit window-start timestamp is the simplest correct model.
 */
async function getRollbackCountInWindow(): Promise<number> {
  const windowStartRaw = await getConfigValue("rollback_window_started_at");
  const windowStart = windowStartRaw ? new Date(windowStartRaw) : null;
  const windowAgeDays = windowStart ? (Date.now() - windowStart.getTime()) / (1000 * 60 * 60 * 24) : Infinity;

  if (windowAgeDays > ROLLBACK_WINDOW_DAYS) {
    await setConfigValue("rollback_window_started_at", new Date().toISOString());
    await setConfigValue("rollback_count_30d", "0");
    return 0;
  }

  const raw = await getConfigValue("rollback_count_30d");
  return raw ? Number.parseInt(raw, 10) : 0;
}

async function recordRollback(): Promise<void> {
  const windowStartRaw = await getConfigValue("rollback_window_started_at");
  if (!windowStartRaw) {
    await setConfigValue("rollback_window_started_at", new Date().toISOString());
  }
  const current = await getRollbackCountInWindow();
  await setConfigValue("rollback_count_30d", String(current + 1));
}

function requireAuth(request: Request): NextResponse | null {
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected) return null;
  const provided = request.headers.get("authorization");
  if (provided !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function configInt(key: string, fallback: number): Promise<number> {
  const raw = await getConfigValue(key);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

interface BatchStats {
  videoIds: number[];
  averageCtrBasisPoints: number;
  allAboveViewThreshold: boolean;
}

async function batchStats(videoIds: number[], minViews: number): Promise<BatchStats> {
  let total = 0;
  let counted = 0;
  let allAbove = videoIds.length > 0;

  for (const id of videoIds) {
    const analytics = await getLatestAnalytics(id);
    if (!analytics || analytics.views < minViews) {
      allAbove = false;
      continue;
    }
    if (analytics.ctrBasisPoints != null) {
      total += analytics.ctrBasisPoints;
      counted++;
    }
  }

  return {
    videoIds,
    averageCtrBasisPoints: counted > 0 ? total / counted : 0,
    allAboveViewThreshold: allAbove && counted === videoIds.length,
  };
}

/**
 * Compares the CTR of the batch produced under the current active P1 version
 * against the batch produced under its predecessor. If the new batch
 * underperforms by more than `rollback_threshold_pct` (default 25%) — and
 * every video in BOTH batches has crossed the view-count reliability floor —
 * reverts to the previous version. Capped at 1 rollback / prompt_key / 30 days
 * (channel_config.rollback_count_30d); beyond that, auto-update pauses and the
 * channel is flagged for manual review (surfaced on the Needs Attention page).
 */
async function evaluateP1Rollback() {
  const minViews = await configInt("rollback_min_views", 100);
  const thresholdPct = await configInt("rollback_threshold_pct", 25);

  const recentVersions = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.promptKey, "P1"))
    .orderBy(desc(promptVersions.version))
    .limit(2);

  const [current, previous] = recentVersions;
  if (!current || !previous) return { evaluated: false, reason: "fewer than 2 versions" };
  if (current.createdBy !== "system_p6") return { evaluated: false, reason: "current version was not auto-applied" };
  if (!current.effectiveFromVideoId || !previous.effectiveFromVideoId) {
    return { evaluated: false, reason: "missing effective_from_video_id anchor" };
  }

  if ((await getRollbackCountInWindow()) >= ROLLBACK_LIMIT_PER_30_DAYS) {
    const wasAlreadyPaused = (await getConfigValue("auto_update_paused")) === "true";
    await setConfigValue("auto_update_paused", "true");
    if (!wasAlreadyPaused) {
      await notify(
        `⏸️ Auto-update for <b>P1</b> has been <b>paused</b> — the rollback rate limit (1 per 30 days) was reached. Review on the dashboard's Needs Attention page.`,
      );
      logEvent("auto_update_paused", { promptKey: "P1" });
    }
    return { evaluated: false, reason: "rollback limit reached — auto-update paused, flagged for manual review" };
  }

  const newBatch = await db
    .select({ id: videos.id })
    .from(videos)
    .where(gte(videos.id, current.effectiveFromVideoId))
    .orderBy(videos.id);
  const oldBatch = await db
    .select({ id: videos.id })
    .from(videos)
    .where(and(gte(videos.id, previous.effectiveFromVideoId), lt(videos.id, current.effectiveFromVideoId)))
    .orderBy(videos.id);

  if (newBatch.length === 0 || oldBatch.length === 0) {
    return { evaluated: false, reason: "one of the batches is empty" };
  }

  const newStats = await batchStats(newBatch.map((v) => v.id), minViews);
  const oldStats = await batchStats(oldBatch.map((v) => v.id), minViews);

  if (!newStats.allAboveViewThreshold || !oldStats.allAboveViewThreshold) {
    return { evaluated: false, reason: "not all videos in both batches have reached the view-count reliability floor yet" };
  }

  const degradationPct =
    oldStats.averageCtrBasisPoints > 0
      ? ((oldStats.averageCtrBasisPoints - newStats.averageCtrBasisPoints) / oldStats.averageCtrBasisPoints) * 100
      : 0;

  if (degradationPct <= thresholdPct) {
    return { evaluated: true, rolledBack: false, degradationPct };
  }

  const changeReason = `Auto-rollback: new batch (videos ${newBatch[0].id}-${newBatch.at(-1)!.id}) CTR ${(newStats.averageCtrBasisPoints / 100).toFixed(2)}% vs previous batch (videos ${oldBatch[0].id}-${oldBatch.at(-1)!.id}) CTR ${(oldStats.averageCtrBasisPoints / 100).toFixed(2)}% — degradation ${degradationPct.toFixed(1)}% exceeds ${thresholdPct}% threshold.`;

  await activateNewPromptVersion({
    promptKey: "P1",
    template: previous.template,
    createdBy: "system_rollback",
    changeReason,
    effectiveFromVideoId: previous.effectiveFromVideoId,
  });

  await recordRollback();

  await notify(`↩️ <b>P1 prompt auto-rolled back</b> to v${previous.version} — ${changeReason}`);
  logEvent("prompt_rollback", { promptKey: "P1", revertedToVersion: previous.version, degradationPct });

  return { evaluated: true, rolledBack: true, degradationPct };
}

export async function GET(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  const result = await evaluateP1Rollback();
  return NextResponse.json({ ok: true, ...result });
}
