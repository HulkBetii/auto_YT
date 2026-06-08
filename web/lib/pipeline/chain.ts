import { getConfigValue } from "../db/repo/channel-config";
import { getJob, markJobConsumed } from "../db/repo/jobs";
import { activateNewPromptVersion } from "../db/repo/prompt-versions";
import { saveVideoContent, getLatestVideoContent } from "../db/repo/video-content";
import { createVideo, getVideo, updateVideoStatus } from "../db/repo/videos";
import type { jobs } from "../db/schema";
import { embedTopic } from "../openai/embeddings";
import { logEvent } from "../observability/log";
import { notify } from "../notifications";
import { isDuplicateTopic } from "./antiDuplication";
import { enqueueStage } from "./createJob";
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

    const embedding = await embedTopic(topic.topic, topic.title);
    const verdict = await isDuplicateTopic({ featuredPerson: topic.featured_person, embedding });
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
    // One-way state transition (scoring -> ready_to_publish happens at most once
    // per video), so this fires exactly once — no extra idempotency flag needed.
    await notify(`✅ <b>${video.title}</b> is ready to publish (score ${score.total_score}).`);
    return;
  }

  if (video.retryCount < maxRetries) {
    const danyi = await getLatestVideoContent(video.id, "P2");
    await updateVideoStatus(video.id, "needs_retry", {
      score: score.total_score,
      retryCount: video.retryCount + 1,
    });
    await enqueueStage({
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
 * marks it consumed so the cron never double-processes it. Each handler is
 * idempotent-ish in intent, but `consumed_at` is the actual guard against
 * re-running on the next poll.
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
