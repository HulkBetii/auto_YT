import { config } from "dotenv";
import { and, asc, eq, or } from "drizzle-orm";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const { db } = await import("../lib/db/index.js");
const { jobs } = await import("../lib/db/schema/jobs.js");
const { videos } = await import("../lib/db/schema/videos.js");
const { runChainCycle } = await import("../lib/pipeline/chain.js");
const { runTTSForReadyVideos } = await import("../lib/pipeline/tts.js");

const maxJobs = Number.parseInt(process.env.E2E_MAX_JOBS ?? "12", 10);
const jobTimeoutSeconds = Number.parseInt(process.env.E2E_JOB_TIMEOUT_SECONDS ?? "1800", 10);
const jobPollSeconds = Number.parseInt(process.env.E2E_JOB_POLL_SECONDS ?? "10", 10);
const ttsPollSeconds = Number.parseInt(process.env.E2E_TTS_POLL_SECONDS ?? "180", 10);

async function nextOpenJob() {
  const [job] = await db
    .select({ id: jobs.id, stage: jobs.stage, status: jobs.status })
    .from(jobs)
    .where(or(eq(jobs.status, "pending"), eq(jobs.status, "running")))
    .orderBy(asc(jobs.id))
    .limit(1);
  return job ?? null;
}

let processedJobs = 0;
const jobDeadline = Date.now() + jobTimeoutSeconds * 1000;
while (processedJobs < maxJobs) {
  const chain = await runChainCycle();
  processedJobs += chain.processed;

  const openJob = await nextOpenJob();
  if (!openJob && chain.processed === 0) break;
  if (Date.now() >= jobDeadline) {
    throw new Error(`Timed out waiting for the Playwright worker after ${jobTimeoutSeconds}s.`);
  }

  if (openJob) {
    console.log(`waiting for Playwright worker: job#${openJob.id} ${openJob.stage} ${openJob.status}`);
  }
  await new Promise((resolveSleep) => setTimeout(resolveSleep, jobPollSeconds * 1000));
}

let ttsResult = await runTTSForReadyVideos();
console.log(`tts tick processed=${ttsResult.processed} results=${ttsResult.results.length}`);

const ttsDeadline = Date.now() + ttsPollSeconds * 1000;
while (Date.now() < ttsDeadline) {
  const [ready] = await db
    .select({ id: videos.id, audioUrl: videos.audioUrl, status: videos.status, ttsTaskId: videos.ttsTaskId })
    .from(videos)
    .where(and(eq(videos.status, "ready_to_publish")))
    .orderBy(asc(videos.id))
    .limit(1);

  if (!ready || ready.audioUrl) break;
  if (ready.ttsTaskId) {
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 10_000));
  }
  ttsResult = await runTTSForReadyVideos();
  console.log(`tts submit/check processed=${ttsResult.processed} results=${ttsResult.results.length}`);
  if (ttsResult.results.some((result) => result.ok)) break;
}

const [latestVideo] = await db.select().from(videos).orderBy(asc(videos.id)).limit(1);
console.log(JSON.stringify({
  processedJobs,
  worker: "playwright",
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
