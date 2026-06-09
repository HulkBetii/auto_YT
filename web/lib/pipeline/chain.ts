import { getConfigValue } from "../db/repo/channel-config";
import { getJob, markJobConsumed, listUnconsumedDoneJobs, listUnconsumedFailedJobs, resetStaleRunningJobs } from "../db/repo/jobs";
import { activateNewPromptVersion } from "../db/repo/prompt-versions";
import { saveVideoContent, getLatestVideoContent } from "../db/repo/video-content";
import { createVideo, getVideo, updateVideoStatus } from "../db/repo/videos";
import type { jobs } from "../db/schema";
import { embedTopic } from "../openai/embeddings";
import { logEvent } from "../observability/log";
import { notify } from "../notifications";
import { isDuplicateTopic } from "./antiDuplication";
import { enqueueStage } from "./createJob";
import { generateAndSaveDescription } from "./descriptionBuilder";
import { extractJson } from "./json";

type Job = typeof jobs.$inferSelect;

interface P1Topic {
  topic: string;
  title: string;
  title_pattern: string;
  pain_type: string;
  temperature: string | number;
  featured_person: string;
  self_address: string;
  reference_book: string;
  viewer_inner_voice: string;
  competition: string;
}

async function configInt(key: string, fallback: number): Promise<number> {
  const raw = await getConfigValue(key);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Walks P1's candidate topics in order, embedding each one and running it
 * through the 2-layer anti-duplication gate (lib/pipeline/antiDuplication.ts):
 * rule check (featured_person repetition) + semantic similarity (pgvector
 * cosine, scoped to last 90 days). Accepted topics are persisted as `videos`
 * immediately — which is what makes the rule check also catch duplicates
 * *within* the same batch, with no extra bookkeeping.
 *
 * Stops once `p1_topics_per_batch` videos have been accepted, or candidates
 * run out (a thin batch is preferable to forcing through near-duplicates).
 */
async function handleP1Done(job: Job) {
  const candidates = extractJson<P1Topic[]>(job.result ?? "");
  const batchSize = await configInt("p1_topics_per_batch", 5);

  let accepted = 0;
  for (const topic of candidates) {
    if (accepted >= batchSize) break;

    // Fail-closed: if OpenAI Embeddings API is unavailable, skip this topic
    // rather than bypassing the semantic check entirely.
    let embedding: number[];
    try {
      embedding = await embedTopic(topic.topic, topic.title);
    } catch (err) {
      console.warn(`[anti-dup] embedding failed for "${topic.title}", skipping topic: ${err}`);
      continue;
    }

    const verdict = await isDuplicateTopic({
      featuredPerson: topic.featured_person,
      painType: topic.pain_type,
      embedding,
    });
    if (verdict.duplicate) {
      console.log(`[anti-dup] skipping "${topic.title}" — ${verdict.reason}`);
      continue;
    }

    const video = await createVideo({
      title: topic.title,
      titlePattern: topic.title_pattern,
      painType: topic.pain_type,
      temperature: Number.parseInt(String(topic.temperature), 10) || null,
      featuredPerson: topic.featured_person,
      referenceBook: topic.reference_book,
      status: "topic",
      topicEmbedding: embedding,
    });
    accepted++;

    await enqueueStage({
      causedByJobId: job.id,
      promptKey: "P2",
      stage: "P2",
      videoId: video.id,
      vars: {
        TITLE: topic.title,
        TOPIC: topic.topic,
        PAIN_TYPE: topic.pain_type,
        TEMP: String(topic.temperature),
        INNER_VOICE: topic.viewer_inner_voice,
        REFERENCE_BOOK: topic.reference_book,
        PERSON: topic.featured_person,
        SELF_ADDRESS: topic.self_address,
      },
    });
  }
}

async function handleP2Done(job: Job) {
  if (!job.videoId) throw new Error(`P2 job ${job.id} has no video_id`);
  const video = await getVideo(job.videoId);
  if (!video) throw new Error(`Video ${job.videoId} not found for P2 job ${job.id}`);

  await saveVideoContent({
    videoId: video.id,
    stage: "P2",
    output: job.result ?? "",
    promptVersionId: job.promptVersionId,
  });
  await updateVideoStatus(video.id, "outline");

  await enqueueStage({
    causedByJobId: job.id,
    promptKey: "P3",
    stage: "P3",
    videoId: video.id,
    vars: {
      DANYI: job.result ?? "",
      TEMP: String(video.temperature ?? ""),
      REFERENCE_BOOK: video.referenceBook ?? "",
      PERSON: video.featuredPerson ?? "",
    },
  });
}

async function handleP3Done(job: Job) {
  if (!job.videoId) throw new Error(`P3 job ${job.id} has no video_id`);
  const video = await getVideo(job.videoId);
  if (!video) throw new Error(`Video ${job.videoId} not found for P3 job ${job.id}`);

  await saveVideoContent({
    videoId: video.id,
    stage: "P3",
    output: job.result ?? "",
    promptVersionId: job.promptVersionId,
  });
  await updateVideoStatus(video.id, "scripted");

  // P2's S6 comment-question is embedded in free-form markdown — rather than
  // brittle-parse it out, we hand P4 the full P2 output as [COMMENT_QUESTION]
  // context and let the model locate it (it already has the full outline).
  const p2Content = await getLatestVideoContent(video.id, "P2");

  await enqueueStage({
    causedByJobId: job.id,
    promptKey: "P4",
    stage: "P4",
    videoId: video.id,
    vars: {
      SCRIPT: job.result ?? "",
      PAIN_TYPE: video.painType ?? "",
      REFERENCE_BOOK: video.referenceBook ?? "",
      COMMENT_QUESTION: p2Content?.output ?? "",
    },
  });
}

async function handleP4Done(job: Job) {
  if (!job.videoId) throw new Error(`P4 job ${job.id} has no video_id`);
  const video = await getVideo(job.videoId);
  if (!video) throw new Error(`Video ${job.videoId} not found for P4 job ${job.id}`);

  await saveVideoContent({
    videoId: video.id,
    stage: "P4",
    output: job.result ?? "",
    promptVersionId: job.promptVersionId,
  });
  await updateVideoStatus(video.id, "seo_done");

  const [p2, p3, p4] = await Promise.all([
    getLatestVideoContent(video.id, "P2"),
    getLatestVideoContent(video.id, "P3"),
    getLatestVideoContent(video.id, "P4"),
  ]);
  const combinedContent = [
    "【構成】", p2?.output ?? "",
    "【台本】", p3?.output ?? "",
    "【SEOパッケージ】", p4?.output ?? "",
  ].join("\n\n");

  await updateVideoStatus(video.id, "scoring");
  await enqueueStage({
    causedByJobId: job.id,
    promptKey: "P_score",
    stage: "P_score",
    videoId: video.id,
    vars: { CONTENT: combinedContent },
  });
}

interface ScoreResult {
  total_score: number;
  verdict?: "publish" | "revise" | "rewrite";
}

async function handlePScoreDone(job: Job) {
  if (!job.videoId) throw new Error(`P_score job ${job.id} has no video_id`);
  const video = await getVideo(job.videoId);
  if (!video) throw new Error(`Video ${job.videoId} not found for P_score job ${job.id}`);

  await saveVideoContent({
    videoId: video.id,
    stage: "P_score",
    output: job.result ?? "",
    promptVersionId: job.promptVersionId,
  });

  const score = extractJson<ScoreResult>(job.result ?? "");
  const threshold = await configInt("score_threshold", 80);
  const maxRetries = await configInt("max_content_retries", 2);

  if (score.total_score >= threshold) {
    await updateVideoStatus(video.id, "ready_to_publish", { score: score.total_score });

    // Build & save YouTube description from P2/P3/P4 outputs (no LLM, code-only).
    // Non-blocking: a description failure should not block ready_to_publish.
    try {
      await generateAndSaveDescription(video.id);
    } catch (err) {
      console.error(`[desc] Video #${video.id} description build failed:`, err);
    }

    // One-way state transition (scoring -> ready_to_publish happens at most once
    // per video), so this fires exactly once — no extra idempotency flag needed.
    await notify(`✅ <b>${video.title}</b> đã sẵn sàng để đăng (điểm ${score.total_score}).`);
    return;
  }

  if (video.retryCount < maxRetries) {
    const danyi = await getLatestVideoContent(video.id, "P2");
    await updateVideoStatus(video.id, "needs_retry", {
      score: score.total_score,
      retryCount: video.retryCount + 1,
    });
    await enqueueStage({
      causedByJobId: job.id,
      promptKey: "P3",
      stage: "P3",
      videoId: video.id,
      vars: {
        DANYI: danyi?.output ?? "",
        TEMP: String(video.temperature ?? ""),
        REFERENCE_BOOK: video.referenceBook ?? "",
        PERSON: video.featuredPerson ?? "",
      },
    });
    return;
  }

  await updateVideoStatus(video.id, "needs_attention", { score: score.total_score });
}

async function handleP5Done(job: Job) {
  if (!job.videoId) throw new Error(`P5 job ${job.id} has no video_id`);
  const video = await getVideo(job.videoId);
  if (!video) throw new Error(`Video ${job.videoId} not found for P5 job ${job.id}`);

  await saveVideoContent({
    videoId: video.id,
    stage: "P5",
    output: job.result ?? "",
    promptVersionId: job.promptVersionId,
  });
  await updateVideoStatus(video.id, "analyzed");
}

export interface BatchRow {
  no: number;
  title: string;
  pattern: string;
  pain: string;
  temp: string;
  person: string;
  lengthMin: string;
  ctrPct: string;
  avdPct: string;
  commentPct: string;
  likePct: string;
}

export function formatBatchTable(rows: BatchRow[]): string {
  const header =
    "No. | タイトル | Pattern | Pain | 温度° | 人物 | 長さ(分) | CTR% | AVD% | コメント率% | いいね率%";
  const lines = rows.map(
    (r) =>
      `${r.no} | ${r.title} | ${r.pattern} | ${r.pain} | ${r.temp} | ${r.person} | ${r.lengthMin} | ${r.ctrPct} | ${r.avdPct} | ${r.commentPct} | ${r.likePct}`,
  );
  return [header, ...lines].join("\n");
}

interface P6Output {
  /** Free-form analysis report — stored verbatim as prompt_versions.change_reason (the audit trail). */
  report: string;
  /** Full rewritten P1 template (the model is instructed to output it verbatim — see P6_TEMPLATE). */
  newP1Template: string;
}

/**
 * P6's prompt asks for "分析レポート＋更新済みPrompt1の全文" — a report followed
 * by the full P1 template. We split on the template's own header line so the
 * template body can be extracted cleanly without asking the model for JSON
 * (which would fight with a multi-thousand-character Japanese prompt body).
 */
function parseP6Output(text: string): P6Output {
  const marker = text.search(/あなたはYouTubeチャンネルのコンテンツストラテジストです/);
  if (marker === -1) {
    throw new Error("P6 output does not contain a recognizable rewritten P1 template.");
  }
  return {
    report: text.slice(0, marker).trim(),
    newP1Template: text.slice(marker).trim(),
  };
}

async function handleP6Done(job: Job) {
  const { report, newP1Template } = parseP6Output(job.result ?? "");
  const metadata = (job.metadata ?? {}) as { batchVideoIds?: number[] };
  const anchorVideoId = metadata.batchVideoIds?.[0];

  await activateNewPromptVersion({
    promptKey: "P1",
    template: newP1Template,
    createdBy: "system_p6",
    changeReason: report,
    effectiveFromVideoId: anchorVideoId,
  });
}

/**
 * Chains a single completed job onward per the pipeline state machine, then
 * marks it consumed so the cron never double-processes it.
 *
 * PARTIALLY-MITIGATED RISK (found + patched during a 2026-06-08 review pass,
 * never hit live): `consumed_at` is stamped *after* the handler runs, not
 * before — so handlers are NOT fully idempotent despite the old comment here
 * claiming otherwise. If a handler throws partway through (e.g. handleP4Done
 * crashes between `updateVideoStatus("seo_done")` and `enqueueStage`, or right
 * after `enqueueStage` but before this function reaches `markJobConsumed`),
 * the cron's per-job try/catch in process-jobs/route.ts swallows the error
 * into `results`, but `consumed_at` stays NULL — so `listUnconsumedDoneJobs`
 * hands the very same job back next tick and the WHOLE handler re-runs.
 *
 * The dangerous half of that — `enqueueStage` inserting a second downstream
 * job (double P_score → double-scoring → duplicate "ready to publish" alert,
 * etc) — is now guarded: every `enqueueStage` call below passes
 * `causedByJobId: job.id`, and `enqueueStage`/`findJobByCause` (see
 * createJob.ts / db/repo/jobs.ts) skip the insert if a job with that exact
 * (cause job, stage, video) triple already exists. Re-running the handler
 * after a crash now just returns the already-created job instead of making a
 * sibling.
 *
 * `saveVideoContent` (db/repo/video-content.ts) got the same treatment: it
 * now dedupes on an exact-match (videoId, stage, output) lookup before
 * inserting — safe because `job.result` is byte-identical between the
 * original run and a crash-rerun (the worker writes it once and never
 * mutates it), while a *legitimate* repeat (needs_retry's fresh P3 attempt)
 * produces different text and is correctly kept as a new history row.
 *
 * Still NOT fully solved: `handleP1Done`'s loop creates brand-new `videos` rows each
 * pass (its `causedByJobId` check can't match an existing entry because the
 * video id itself differs run-to-run); that's only loosely mitigated by
 * `isDuplicateTopic`'s person/embedding checks rejecting the re-offered topic.
 * A full fix there would mean making `createVideo` idempotent per source
 * topic — left as a known follow-up, not a drive-by patch.
 */
export async function processDoneJob(jobId: number) {
  const job = await getJob(jobId);
  if (!job || job.status !== "done" || job.consumedAt) return;

  const startedAt = Date.now();

  switch (job.stage) {
    case "P1":
      await handleP1Done(job);
      break;
    case "P2":
      await handleP2Done(job);
      break;
    case "P3":
      await handleP3Done(job);
      break;
    case "P4":
      await handleP4Done(job);
      break;
    case "P_score":
      await handlePScoreDone(job);
      break;
    case "P5":
      await handleP5Done(job);
      break;
    case "P6":
      await handleP6Done(job);
      break;
    default:
      break;
  }

  await markJobConsumed(job.id);

  logEvent("job_chained", {
    jobId: job.id,
    videoId: job.videoId,
    stage: job.stage,
    durationMs: Date.now() - startedAt,
  });
}

/**
 * Hard-failed jobs are terminal — nothing in this file ever consumes them, so
 * `consumed_at` doubles here as "the orchestrator has acknowledged this failure
 * and notified about it," preventing the same job from re-alerting every poll.
 */
async function notifyNewlyFailedJobs() {
  const failed = await listUnconsumedFailedJobs();

  for (const job of failed) {
    await notify(
      `🔴 Job #${job.id} (<b>${job.stage}</b>)${job.videoId ? ` của video #${job.videoId}` : ""} đã thất bại: ${job.errorMessage ?? "lỗi không xác định"}`,
    );
    await markJobConsumed(job.id);
    logEvent("job_failed_notified", { jobId: job.id, videoId: job.videoId, stage: job.stage });
  }

  return failed.length;
}

export interface ChainCycleResult {
  processed: number;
  results: Array<{ jobId: number; ok: boolean; error?: string }>;
  failedNotified: number;
}

/**
 * One full pass of the orchestration loop: chains every unconsumed `done` job
 * forward (see `processDoneJob`), then notifies about any newly hard-failed
 * ones. This is the single source of truth for "advance the pipeline by one
 * tick" — both `/api/cron/process-jobs` (polled by Vercel Cron, when
 * configured) and the dashboard's manual "Chạy pipeline ngay" button
 * (`/api/jobs/process-now`, see RunPipelineButton) call this so there is
 * exactly one implementation of the chaining cycle to keep correct.
 *
 * NOTE (2026-06-08): at the time this was extracted, `process-jobs` was found
 * to NOT actually be registered in vercel.json's cron list (only
 * evaluate-rollback and generate-topics are — likely a Vercel Hobby plan
 * 2-cron-job limit), despite the README documenting it as "every minute".
 * Without something calling this on a schedule, completed jobs pile up with
 * `consumed_at = NULL` and the pipeline stalls after each stage. The manual
 * button is the stop-gap until an external scheduler (or Claude's own
 * scheduled-tasks) is wired up to hit this on a regular cadence.
 */
export async function runChainCycle(): Promise<ChainCycleResult> {
  // Auto-reset jobs stuck in `running` > 15 min (worker crash / timeout).
  const staleReset = await resetStaleRunningJobs(15);
  if (staleReset > 0) {
    console.warn(`[chain] reset ${staleReset} stale running job(s) → pending`);
  }

  const pendingJobs = await listUnconsumedDoneJobs();
  const results: Array<{ jobId: number; ok: boolean; error?: string }> = [];

  for (const job of pendingJobs) {
    try {
      await processDoneJob(job.id);
      results.push({ jobId: job.id, ok: true });
    } catch (error) {
      results.push({
        jobId: job.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failedNotified = await notifyNewlyFailedJobs();

  return { processed: results.length, results, failedNotified };
}
