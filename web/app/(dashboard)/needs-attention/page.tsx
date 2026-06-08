import Link from "next/link";
import { and, desc, eq, isNull, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { getConfigValue } from "@/lib/db/repo/channel-config";
import { getLatestAnalytics } from "@/lib/db/repo/video-analytics";
import { jobs, promptVersions, videos } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/ui/format";

import { YoutubeIdForm } from "../videos/[id]/YoutubeIdForm";
import { AnalyticsForm } from "./AnalyticsForm";
import { RetryJobButton } from "./RetryJobButton";

export const dynamic = "force-dynamic";

async function getMissingYoutubeId() {
  return db
    .select()
    .from(videos)
    .where(and(eq(videos.status, "published"), isNull(videos.youtubeVideoId)))
    .orderBy(desc(videos.publishedAt));
}

async function getMissingManualAnalytics() {
  const candidates = await db
    .select()
    .from(videos)
    .where(or(eq(videos.status, "published"), eq(videos.status, "analyzed")))
    .orderBy(desc(videos.publishedAt));

  const withMissing: { video: (typeof candidates)[number]; missingCtr: boolean; missingAvd: boolean }[] = [];
  for (const video of candidates) {
    const latest = await getLatestAnalytics(video.id);
    if (!latest) continue;
    const missingCtr = latest.ctrBasisPoints == null;
    const missingAvd = latest.averageViewDurationSeconds == null;
    if (missingCtr || missingAvd) withMissing.push({ video, missingCtr, missingAvd });
  }
  return withMissing;
}

async function getHardFailedJobs() {
  return db
    .select({
      id: jobs.id,
      stage: jobs.stage,
      videoId: jobs.videoId,
      errorMessage: jobs.errorMessage,
      retryCount: jobs.retryCount,
      createdAt: jobs.createdAt,
      videoTitle: videos.title,
    })
    .from(jobs)
    .leftJoin(videos, eq(jobs.videoId, videos.id))
    .where(eq(jobs.status, "failed"))
    .orderBy(desc(jobs.createdAt));
}

async function getFlaggedPromptVersions() {
  const paused = await getConfigValue("auto_update_paused");
  if (paused !== "true") return [];
  return db.select().from(promptVersions).where(eq(promptVersions.isActive, true)).orderBy(promptVersions.promptKey);
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
        <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {count}
        </span>
      </h2>
      {children}
    </section>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
      {children}
    </div>
  );
}

export default async function NeedsAttentionPage() {
  const [missingYoutubeId, missingAnalytics, failedJobs, flaggedPrompts] = await Promise.all([
    getMissingYoutubeId(),
    getMissingManualAnalytics(),
    getHardFailedJobs(),
    getFlaggedPromptVersions(),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Needs Attention</h1>

      <Section title="Published videos missing a YouTube video ID" count={missingYoutubeId.length}>
        <div className="flex flex-col gap-3">
          {missingYoutubeId.map((video) => (
            <div key={video.id} className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <Link href={`/videos/${video.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                {video.title}
              </Link>
              <YoutubeIdForm videoId={video.id} currentValue={video.youtubeVideoId} />
            </div>
          ))}
          {missingYoutubeId.length === 0 && <EmptyRow>Nothing pending — all published videos have a YouTube ID.</EmptyRow>}
        </div>
      </Section>

      <Section title="Videos missing manually-entered analytics (CTR / avg. view duration)" count={missingAnalytics.length}>
        <div className="flex flex-col gap-3">
          {missingAnalytics.map(({ video, missingCtr, missingAvd }) => (
            <div key={video.id} className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-center justify-between">
                <Link href={`/videos/${video.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                  {video.title}
                </Link>
                <span className="text-xs text-zinc-500">
                  Missing: {[missingCtr && "CTR", missingAvd && "avg. view duration"].filter(Boolean).join(", ")}
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                These require YouTube Analytics OAuth (not available via the plain Data API key) — enter the values from
                YouTube Studio manually.
              </p>
              <AnalyticsForm videoId={video.id} />
            </div>
          ))}
          {missingAnalytics.length === 0 && <EmptyRow>Nothing pending — all tracked videos have full analytics.</EmptyRow>}
        </div>
      </Section>

      <Section title="Hard-failed jobs" count={failedJobs.length}>
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2">Stage</th>
                <th className="px-4 py-2">Video</th>
                <th className="px-4 py-2">Error</th>
                <th className="px-4 py-2">Retries</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {failedJobs.map((job) => (
                <tr key={job.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{job.stage}</td>
                  <td className="px-4 py-2">
                    {job.videoId ? (
                      <Link href={`/videos/${job.videoId}`} className="text-zinc-700 hover:underline dark:text-zinc-300">
                        {job.videoTitle ?? `#${job.videoId}`}
                      </Link>
                    ) : (
                      <span className="text-zinc-500">batch job</span>
                    )}
                  </td>
                  <td className="max-w-sm truncate px-4 py-2 text-red-600 dark:text-red-400">{job.errorMessage ?? "—"}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{job.retryCount}</td>
                  <td className="px-4 py-2 text-zinc-500">{formatDateTime(job.createdAt)}</td>
                  <td className="px-4 py-2"><RetryJobButton jobId={job.id} /></td>
                </tr>
              ))}
              {failedJobs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">No hard-failed jobs. 🎉</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Prompt versions flagged after rollback cap" count={flaggedPrompts.length}>
        <div className="flex flex-col gap-3">
          {flaggedPrompts.map((version) => (
            <div key={version.id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <span>
                <Link href={`/prompts/${version.promptKey}`} className="font-medium hover:underline">
                  {version.promptKey} v{version.version}
                </Link>{" "}
                — auto-update is paused (rollback rate limit reached: 1 per 30 days). Review the change history and either
                resume from the prompt page or activate a different version manually.
              </span>
            </div>
          ))}
          {flaggedPrompts.length === 0 && <EmptyRow>No prompts are currently flagged — auto-update is running normally.</EmptyRow>}
        </div>
      </Section>
    </div>
  );
}
