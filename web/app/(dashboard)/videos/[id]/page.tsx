import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { jobs, videoAnalytics, videoContent } from "@/lib/db/schema";
import { formatDateTime, formatDuration, statusBadgeClass } from "@/lib/ui/format";
import { getVideo } from "@/lib/db/repo/videos";
import { buildTTSStatusChecker } from "@/lib/pipeline/ttsVoiceMap";

import { YoutubeIdForm } from "./YoutubeIdForm";

export const dynamic = "force-dynamic";

export default async function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const videoId = Number.parseInt(id, 10);
  if (!Number.isFinite(videoId)) notFound();

  const video = await getVideo(videoId);
  if (!video) notFound();

  const [content, videoJobs, analytics, ttsStatusFn] = await Promise.all([
    db.select().from(videoContent).where(eq(videoContent.videoId, videoId)).orderBy(videoContent.createdAt),
    db.select().from(jobs).where(eq(jobs.videoId, videoId)).orderBy(jobs.createdAt),
    db.select().from(videoAnalytics).where(eq(videoAnalytics.videoId, videoId)).orderBy(videoAnalytics.fetchedAt),
    buildTTSStatusChecker(),
  ]);
  const ttsStatus = ttsStatusFn(video.featuredPerson, video.audioUrl);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link href="/videos" className="text-sm text-zinc-500 hover:underline">
          ← Tất cả video
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{video.title}</h1>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass(video.status)}`}>{video.status}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400 sm:grid-cols-4">
          <div><dt className="text-xs uppercase text-zinc-400">Nhân vật</dt><dd>{video.featuredPerson ?? "—"}</dd></div>
          <div><dt className="text-xs uppercase text-zinc-400">Loại nỗi đau</dt><dd>{video.painType ?? "—"}</dd></div>
          <div><dt className="text-xs uppercase text-zinc-400">Nhiệt độ</dt><dd>{video.temperature ?? "—"}</dd></div>
          <div><dt className="text-xs uppercase text-zinc-400">Định dạng</dt><dd>{video.format}</dd></div>
          <div><dt className="text-xs uppercase text-zinc-400">Điểm</dt><dd>{video.score ?? "—"}</dd></div>
          <div><dt className="text-xs uppercase text-zinc-400">Số lần thử lại</dt><dd>{video.retryCount}</dd></div>
          <div><dt className="text-xs uppercase text-zinc-400">YouTube ID</dt><dd>{video.youtubeVideoId ?? "—"}</dd></div>
          <div><dt className="text-xs uppercase text-zinc-400">Ngày đăng</dt><dd>{formatDateTime(video.publishedAt)}</dd></div>
        </dl>
      </div>

      {(video.status === "ready_to_publish" || video.status === "published" || video.status === "analyzed") && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <YoutubeIdForm videoId={video.id} currentValue={video.youtubeVideoId} />
        </section>
      )}

      {ttsStatus === "done" && video.audioUrl ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Audio TTS
          </h2>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={video.audioUrl} className="w-full max-w-lg" />
          <a
            href={video.audioUrl}
            download
            className="mt-2 inline-block text-xs text-blue-500 hover:underline"
          >
            Tải xuống
          </a>
        </section>
      ) : ttsStatus === "pending" ? (
        <section className="rounded-lg border border-dashed border-blue-300 p-4 text-center text-sm text-blue-600 dark:border-blue-800 dark:text-blue-400">
          ⏳ Audio TTS đang chờ xử lý — sẽ tự động tạo ở cron tick tiếp theo (~5 phút).
        </section>
      ) : ttsStatus === "no_mapping" && (video.status === "ready_to_publish" || video.status === "published" || video.status === "analyzed") ? (
        <section className="rounded-lg border border-dashed border-amber-300 p-4 dark:border-amber-800">
          <p className="text-center text-sm text-amber-700 dark:text-amber-400">
            ⚠ Chưa có clone voice cho <strong>{video.featuredPerson ?? "nhân vật này"}</strong>.
          </p>
          <p className="mt-1 text-center text-xs text-zinc-500">
            Thêm mapping vào{" "}
            <a href="/settings" className="text-blue-500 hover:underline">Cài đặt → Bản đồ giọng TTS</a>
            {" "}rồi chạy pipeline để tạo audio.
          </p>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Dòng thời gian pipeline (P1 → P_score)
        </h2>
        <ol className="flex flex-col gap-3">
          {content.map((row) => (
            <li key={row.id} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-2 flex items-center justify-between">
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {row.stage}
                </span>
                <span className="text-xs text-zinc-500">{formatDateTime(row.createdAt)}</span>
              </div>
              <details>
                <summary className="cursor-pointer text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
                  Xem nội dung ({row.output.length.toLocaleString()} ký tự)
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-3 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {row.output}
                </pre>
              </details>
            </li>
          ))}
          {content.length === 0 && (
            <li className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
              Chưa có nội dung nào được tạo.
            </li>
          )}
        </ol>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Job</h2>
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2">Giai đoạn</th>
                <th className="px-4 py-2">Trạng thái</th>
                <th className="px-4 py-2">Số lần thử lại</th>
                <th className="px-4 py-2">Thời lượng</th>
                <th className="px-4 py-2">Lỗi</th>
                <th className="px-4 py-2">Tạo lúc</th>
              </tr>
            </thead>
            <tbody>
              {videoJobs.map((job) => {
                const durationSec =
                  job.startedAt && job.finishedAt
                    ? (job.finishedAt.getTime() - job.startedAt.getTime()) / 1000
                    : null;
                return (
                  <tr key={job.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{job.stage}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass(job.status)}`}>{job.status}</span>
                    </td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{job.retryCount}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{formatDuration(durationSec)}</td>
                    <td className="px-4 py-2 max-w-xs truncate text-red-600 dark:text-red-400">{job.errorMessage ?? "—"}</td>
                    <td className="px-4 py-2 text-zinc-500">{formatDateTime(job.createdAt)}</td>
                  </tr>
                );
              })}
              {videoJobs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">Video này chưa có job nào.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {analytics.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Ảnh chụp Analytics</h2>
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-2">Lấy lúc</th>
                  <th className="px-4 py-2">Lượt xem</th>
                  <th className="px-4 py-2">Lượt thích</th>
                  <th className="px-4 py-2">Bình luận</th>
                  <th className="px-4 py-2">CTR</th>
                  <th className="px-4 py-2">Thời lượng xem TB</th>
                </tr>
              </thead>
              <tbody>
                {analytics.map((row) => (
                  <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2 text-zinc-500">{formatDateTime(row.fetchedAt)}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{row.views}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{row.likes ?? "—"}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{row.comments ?? "—"}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                      {row.ctrBasisPoints != null ? `${(row.ctrBasisPoints / 100).toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{formatDuration(row.averageViewDurationSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
