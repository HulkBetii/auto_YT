import { desc, eq, count } from "drizzle-orm";
import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const { db } = await import("../lib/db");
const { channelConfig } = await import("../lib/db/schema/channel-config");
const { jobs } = await import("../lib/db/schema/jobs");
const { promptVersions } = await import("../lib/db/schema/prompt-versions");
const { videos } = await import("../lib/db/schema/videos");

const jobCounts = await db.select({ status: jobs.status, n: count() }).from(jobs).groupBy(jobs.status);
const videoCounts = await db.select({ status: videos.status, n: count() }).from(videos).groupBy(videos.status);
const recentJobs = await db
  .select({
    id: jobs.id,
    videoId: jobs.videoId,
    stage: jobs.stage,
    status: jobs.status,
    retryCount: jobs.retryCount,
    consumedAt: jobs.consumedAt,
    errorMessage: jobs.errorMessage,
  })
  .from(jobs)
  .orderBy(desc(jobs.id))
  .limit(20);
const configRows = await db
  .select({
    key: channelConfig.key,
    value: channelConfig.value,
    workerLastSeenAt: channelConfig.workerLastSeenAt,
    workerLastStatus: channelConfig.workerLastStatus,
  })
  .from(channelConfig);
const latestVideo = await db.select().from(videos).orderBy(desc(videos.id)).limit(1);
const activePrompts = await db
  .select({ key: promptVersions.promptKey, version: promptVersions.version, id: promptVersions.id })
  .from(promptVersions)
  .where(eq(promptVersions.isActive, true));

console.log(JSON.stringify({
  jobCounts,
  videoCounts,
  latestVideo: latestVideo[0] ? {
    id: latestVideo[0].id,
    title: latestVideo[0].title,
    status: latestVideo[0].status,
    score: latestVideo[0].score,
    audioUrl: latestVideo[0].audioUrl,
    featuredPerson: latestVideo[0].featuredPerson,
    archetype: latestVideo[0].contentArchetype,
    commentMode: latestVideo[0].commentMode,
  } : null,
  recentJobs,
  activePrompts,
  configKeys: configRows.map((row) => ({
    key: row.key,
    hasValue: row.value != null && row.value !== "",
    workerLastSeenAt: row.workerLastSeenAt,
    workerLastStatus: row.workerLastStatus,
  })),
}, null, 2));

process.exit(0);
