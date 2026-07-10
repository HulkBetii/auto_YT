import { config } from "dotenv";
import { and, asc, eq } from "drizzle-orm";
import OpenAI from "openai";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const { db } = await import("../lib/db/index.js");
const { jobs } = await import("../lib/db/schema/jobs.js");
const { videos } = await import("../lib/db/schema/videos.js");
const { runChainCycle } = await import("../lib/pipeline/chain.js");
const { runTTSForReadyVideos } = await import("../lib/pipeline/tts.js");

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

const model = process.env.E2E_OPENAI_MODEL ?? "gpt-4.1-mini";
const maxJobs = Number.parseInt(process.env.E2E_MAX_JOBS ?? "12", 10);
const ttsPollSeconds = Number.parseInt(process.env.E2E_TTS_POLL_SECONDS ?? "180", 10);
const client = new OpenAI({ apiKey });

async function nextPendingJob() {
  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "pending"))
    .orderBy(asc(jobs.id))
    .limit(1);
  return job ?? null;
}

async function completeJobWithOpenAI(job: NonNullable<Awaited<ReturnType<typeof nextPendingJob>>>) {
  await db
    .update(jobs)
    .set({ status: "running", startedAt: new Date(), errorMessage: null })
    .where(eq(jobs.id, job.id));

  try {
    const response = await client.chat.completions.create({
      model,
      temperature: job.stage === "P_score" ? 0.1 : 0.7,
      messages: [
        {
          role: "system",
          content:
            "Follow the user's prompt exactly. Return only the requested output format. Do not add explanations outside the requested format.",
        },
        { role: "user", content: job.promptText },
      ],
    });
    const result = response.choices[0]?.message?.content?.trim();
    if (!result) throw new Error("OpenAI returned empty content");

    await db
      .update(jobs)
      .set({ status: "done", result, finishedAt: new Date(), errorMessage: null })
      .where(eq(jobs.id, job.id));
    console.log(`done job#${job.id} ${job.stage} (${result.length} chars)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(jobs)
      .set({ status: "failed", finishedAt: new Date(), errorMessage: message })
      .where(eq(jobs.id, job.id));
    console.log(`failed job#${job.id} ${job.stage}: ${message}`);
    throw error;
  }
}

let processed = 0;
while (processed < maxJobs) {
  const job = await nextPendingJob();
  if (!job) break;
  await completeJobWithOpenAI(job);
  processed++;
  const chain = await runChainCycle();
  console.log(`chain processed=${chain.processed}`);
}

let ttsResult = await runTTSForReadyVideos();
console.log(`tts tick processed=${ttsResult.processed} results=${ttsResult.results.length}`);

const deadline = Date.now() + ttsPollSeconds * 1000;
while (Date.now() < deadline) {
  const [ready] = await db
    .select({ id: videos.id, audioUrl: videos.audioUrl, status: videos.status, ttsTaskId: videos.ttsTaskId })
    .from(videos)
    .where(and(eq(videos.status, "ready_to_publish")))
    .orderBy(asc(videos.id))
    .limit(1);

  if (!ready) break;
  if (ready.audioUrl) break;
  if (!ready.ttsTaskId) {
    ttsResult = await runTTSForReadyVideos();
    console.log(`tts submit/check processed=${ttsResult.processed} results=${ttsResult.results.length}`);
  } else {
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 10_000));
    ttsResult = await runTTSForReadyVideos();
    console.log(`tts check processed=${ttsResult.processed} results=${ttsResult.results.length}`);
    if (ttsResult.results.some((result) => result.ok)) break;
  }
}

const [latestVideo] = await db.select().from(videos).orderBy(asc(videos.id)).limit(1);
console.log(JSON.stringify({
  processedJobs: processed,
  model,
  latestVideo: latestVideo ? {
    id: latestVideo.id,
    status: latestVideo.status,
    score: latestVideo.score,
    title: latestVideo.title,
    featuredPerson: latestVideo.featuredPerson,
    contentArchetype: latestVideo.contentArchetype,
    commentMode: latestVideo.commentMode,
    audioUrl: latestVideo.audioUrl,
    ttsTaskId: latestVideo.ttsTaskId,
  } : null,
}, null, 2));

process.exit(0);
