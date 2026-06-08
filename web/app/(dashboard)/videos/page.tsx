import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { videos, videoStatusEnum } from "@/lib/db/schema";
import { formatDateTime, statusBadgeClass } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

const ALL = "all";
type StatusFilter = (typeof videoStatusEnum.enumValues)[number] | typeof ALL;

async function getVideos(filter: StatusFilter) {
  if (filter === ALL) {
    return db.select().from(videos).orderBy(desc(videos.createdAt)).limit(100);
  }
  return db.select().from(videos).where(eq(videos.status, filter)).orderBy(desc(videos.createdAt)).limit(100);
}

export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter: StatusFilter = (videoStatusEnum.enumValues as readonly string[]).includes(status ?? "")
    ? (status as StatusFilter)
    : ALL;

  const rows = await getVideos(filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Videos</h1>
        <div className="flex flex-wrap gap-1">
          <Link
            href="/videos"
            className={`rounded px-3 py-1 text-xs font-medium ${filter === ALL ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}
          >
            all
          </Link>
          {videoStatusEnum.enumValues.map((s) => (
            <Link
              key={s}
              href={`/videos?status=${s}`}
              className={`rounded px-3 py-1 text-xs font-medium ${filter === s ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}
            >
              {s}
            </Link>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Person</th>
              <th className="px-4 py-2">Score</th>
              <th className="px-4 py-2">Retries</th>
              <th className="px-4 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((video) => (
              <tr key={video.id} className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
                <td className="px-4 py-2 text-zinc-500">#{video.id}</td>
                <td className="px-4 py-2">
                  <Link href={`/videos/${video.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                    {video.title}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass(video.status)}`}>{video.status}</span>
                </td>
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{video.featuredPerson ?? "—"}</td>
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{video.score ?? "—"}</td>
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{video.retryCount}</td>
                <td className="px-4 py-2 text-zinc-500">{formatDateTime(video.createdAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                  No videos match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
