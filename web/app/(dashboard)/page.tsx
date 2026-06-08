import Link from "next/link";
import { desc, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { jobs, videoContent, videos } from "@/lib/db/schema";
import { formatDuration, formatRelative, statusBadgeClass } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

async function getVideoStatusCounts() {
  return db
    .select({ status: videos.status, count: sql<number>`count(*)::int` })
    .from(videos)
    .groupBy(videos.status);
}

async function getJobStatusCounts() {
  return db
    .select({ status: jobs.status, count: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.status);
}

async function getAvgStageDuration() {
  return db
    .select({
      stage: jobs.stage,
      avgSeconds: sql<number>`avg(extract(epoch from (${jobs.finishedAt} - ${jobs.startedAt})))::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(jobs)
    .where(isNotNull(jobs.finishedAt))
    .groupBy(jobs.stage);
}

async function getRecentActivity() {
  const recentContent = await db
    .select({
      id: videoContent.id,
      videoId: videoContent.videoId,
      stage: videoContent.stage,
      createdAt: videoContent.createdAt,
      videoTitle: videos.title,
    })
    .from(videoContent)
    .leftJoin(videos, eq(videoContent.videoId, videos.id))
    .orderBy(desc(videoContent.createdAt))
    .limit(12);

  return recentContent;
}

export default async function DashboardPage() {
  const [videoCounts, jobCounts, avgDurations, recentActivity] = await Promise.all([
    getVideoStatusCounts(),
    getJobStatusCounts(),
    getAvgStageDuration(),
    getRecentActivity(),
  ]);

  const videoTotal = videoCounts.reduce((acc, r) => acc + r.count, 0);
  const jobTotal = jobCounts.reduce((acc, r) => acc + r.count, 0);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Video theo trạng thái (tổng {videoTotal})
        </h2>
        <div className="flex flex-wrap gap-3">
          {videoCounts.map((row) => (
            <div
              key={row.status}
              className="flex min-w-[140px] flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <span className={`w-fit rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass(row.status)}`}>
                {row.status}
              </span>
              <span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{row.count}</span>
            </div>
          ))}
          {videoCounts.length === 0 && <p className="text-sm text-zinc-500">Chưa có video nào.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Job theo trạng thái (tổng {jobTotal})
        </h2>
        <div className="flex flex-wrap gap-3">
          {jobCounts.map((row) => (
            <div
              key={row.status}
              className="flex min-w-[140px] flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <span className={`w-fit rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass(row.status)}`}>
                {row.status}
              </span>
              <span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{row.count}</span>
            </div>
          ))}
          {jobCounts.length === 0 && <p className="text-sm text-zinc-500">Chưa có job nào.</p>}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Thời gian xử lý trung bình theo giai đoạn
          </h2>
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-2">Giai đoạn</th>
                  <th className="px-4 py-2">Thời lượng TB</th>
                  <th className="px-4 py-2">Số lượng mẫu</th>
                </tr>
              </thead>
              <tbody>
                {avgDurations.map((row) => (
                  <tr key={row.stage} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{row.stage}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{formatDuration(row.avgSeconds)}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{row.count}</td>
                  </tr>
                ))}
                {avgDurations.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                      Chưa có job nào hoàn thành.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Hoạt động gần đây
          </h2>
          <ul className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
            {recentActivity.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 rounded px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <Link href={`/videos/${row.videoId}`} className="truncate text-zinc-700 hover:underline dark:text-zinc-300">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{row.stage}</span>{" "}
                  đã tạo cho <span className="truncate">{row.videoTitle ?? `video #${row.videoId}`}</span>
                </Link>
                <span className="shrink-0 text-xs text-zinc-500">{formatRelative(row.createdAt)}</span>
              </li>
            ))}
            {recentActivity.length === 0 && <li className="px-3 py-6 text-center text-sm text-zinc-500">Chưa có hoạt động nào.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
