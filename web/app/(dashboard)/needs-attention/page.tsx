import Link from "next/link";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";
import { db } from "@/lib/db";
import { getConfigValue } from "@/lib/db/repo/channel-config";
import { getLatestAnalytics } from "@/lib/db/repo/video-analytics";
import { jobs, promptVersions, videos } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/ui/format";
import { buildTTSStatusChecker } from "@/lib/pipeline/ttsVoiceMap";
import { MAX_RENDER_ATTEMPTS } from "@/lib/render/state";
import { YoutubeIdInline } from "../videos/[id]/YoutubeIdInline";
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
  const withMissing: {
    video: (typeof candidates)[number];
    missingCtr: boolean;
    missingAvd: boolean;
  }[] = [];
  for (const video of candidates) {
    const latest = await getLatestAnalytics(video.id);
    if (!latest) continue;
    const missingCtr = latest.ctrBasisPoints == null;
    const missingAvd = latest.averageViewDurationSeconds == null;
    if (missingCtr || missingAvd)
      withMissing.push({ video, missingCtr, missingAvd });
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
async function getTerminalRenderFailures() {
  return db
    .select({
      id: videos.id,
      title: videos.title,
      renderError: videos.renderError,
      renderAttemptCount: videos.renderAttemptCount,
      renderFinishedAt: videos.renderFinishedAt,
    })
    .from(videos)
    .where(
      and(
        eq(videos.renderStatus, "failed"),
        or(
          gte(videos.renderAttemptCount, MAX_RENDER_ATTEMPTS),
          isNull(videos.renderNextAttemptAt),
        ),
      ),
    )
    .orderBy(desc(videos.renderFinishedAt));
}
async function getMissingTtsText() {
  return db
    .select({ id: videos.id, title: videos.title })
    .from(videos)
    .where(and(isNotNull(videos.audioUrl), isNull(videos.ttsText)))
    .orderBy(desc(videos.id));
}
async function getMissingVoiceMappings() {
  const [candidates, getTtsStatus] = await Promise.all([
    db
      .select({
        id: videos.id,
        title: videos.title,
        featuredPerson: videos.featuredPerson,
        audioUrl: videos.audioUrl,
        ttsTaskId: videos.ttsTaskId,
        ttsSubmittedAt: videos.ttsSubmittedAt,
      })
      .from(videos)
      .where(
        and(
          inArray(videos.status, [
            "ready_to_publish",
            "published",
            "analyzed",
          ]),
          isNull(videos.audioUrl),
        ),
      )
      .orderBy(desc(videos.id)),
    buildTTSStatusChecker(),
  ]);
  return candidates.filter(
    (video) =>
      getTtsStatus({
        featuredPerson: video.featuredPerson,
        audioUrl: video.audioUrl,
        ttsTaskId: video.ttsTaskId,
        ttsSubmittedAt: video.ttsSubmittedAt,
      }) === "no_mapping",
  );
}
async function getFlaggedPromptVersions() {
  const paused = await getConfigValue("auto_update_paused");
  if (paused !== "true") return [];
  return db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.isActive, true))
    .orderBy(promptVersions.promptKey);
}
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)] ">
        {title}
        <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--text-secondary)] ">
          {count}
        </span>
      </h2>
      {children}
    </section>
  );
}
function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--text-muted)] ">
      {children}
    </div>
  );
}
export default async function NeedsAttentionPage() {
  const [
    missingYoutubeId,
    missingAnalytics,
    failedJobs,
    flaggedPrompts,
    renderFailures,
    missingTtsText,
    missingVoiceMappings,
  ] = await Promise.all([
      getMissingYoutubeId(),
      getMissingManualAnalytics(),
      getHardFailedJobs(),
      getFlaggedPromptVersions(),
      getTerminalRenderFailures(),
      getMissingTtsText(),
      getMissingVoiceMappings(),
    ]);
  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-xl font-semibold text-[var(--text-primary)] ">
        Cần chú ý
      </h1>
      <Section
        title="Video đã đăng nhưng thiếu YouTube video ID"
        count={missingYoutubeId.length}
      >
        <div className="flex flex-col gap-3">
          {missingYoutubeId.map((video) => (
            <div
              key={video.id}
              className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 "
            >
              <Link
                href={`/videos/${video.id}`}
                className="font-medium text-[var(--text-primary)] hover:underline "
              >
                {video.title}
              </Link>
              <YoutubeIdInline
                videoId={video.id}
                currentValue={video.youtubeVideoId}
              />
            </div>
          ))}
          {missingYoutubeId.length === 0 && (
            <EmptyRow>
              Không có gì cần xử lý — mọi video đã đăng đều có YouTube ID.
            </EmptyRow>
          )}
        </div>
      </Section>
      <Section
        title="Video thiếu dữ liệu analytics nhập tay (CTR / thời lượng xem TB)"
        count={missingAnalytics.length}
      >
        <div className="flex flex-col gap-3">
          {missingAnalytics.map(({ video, missingCtr, missingAvd }) => (
            <div
              key={video.id}
              className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 "
            >
              <div className="flex items-center justify-between">
                <Link
                  href={`/videos/${video.id}`}
                  className="font-medium text-[var(--text-primary)] hover:underline "
                >
                  {video.title}
                </Link>
                <span className="text-xs text-[var(--text-muted)]">
                  Thiếu:
                  {[missingCtr && "CTR", missingAvd && "thời lượng xem TB"]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Các chỉ số này cần YouTube Analytics OAuth (không có sẵn qua
                Data API key thường) — hãy nhập thủ công từ YouTube Studio.
              </p>
              <AnalyticsForm videoId={video.id} />
            </div>
          ))}
          {missingAnalytics.length === 0 && (
            <EmptyRow>
              Không có gì cần xử lý — mọi video đang theo dõi đều đã đủ dữ liệu
              analytics.
            </EmptyRow>
          )}
        </div>
      </Section>
      <Section title="Render lỗi terminal" count={renderFailures.length}>
        <div className="flex flex-col gap-3">
          {renderFailures.map((video) => (
            <div
              key={video.id}
              className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-4"
            >
              <Link
                href={`/videos/${video.id}`}
                className="font-medium text-[var(--text-primary)] hover:underline"
              >
                #{video.id} {video.title}
              </Link>
              <p className="mt-1 text-[13px] text-[var(--danger)]">
                Attempt {video.renderAttemptCount} / {MAX_RENDER_ATTEMPTS}: {video.renderError ?? "Không rõ lỗi"}
              </p>
            </div>
          ))}
          {renderFailures.length === 0 && (
            <EmptyRow>Không có render lỗi terminal.</EmptyRow>
          )}
        </div>
      </Section>
      <Section title="Có audio nhưng thiếu text TTS" count={missingTtsText.length}>
        <div className="flex flex-col gap-3">
          {missingTtsText.map((video) => (
            <Link
              key={video.id}
              href={`/videos/${video.id}`}
              className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-4 font-medium text-[var(--text-primary)] hover:underline"
            >
              #{video.id} {video.title}
            </Link>
          ))}
          {missingTtsText.length === 0 && (
            <EmptyRow>Không có video bị chặn vì thiếu text TTS.</EmptyRow>
          )}
        </div>
      </Section>
      <Section title="TTS thiếu voice mapping" count={missingVoiceMappings.length}>
        <div className="flex flex-col gap-3">
          {missingVoiceMappings.map((video) => (
            <div
              key={video.id}
              className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4"
            >
              <Link
                href={`/videos/${video.id}`}
                className="font-medium text-[var(--text-primary)] hover:underline"
              >
                #{video.id} {video.title}
              </Link>
              <p className="mt-1 text-[13px] text-[var(--warning)]">
                Persona: {video.featuredPerson ?? "chưa xác định"}. Thêm mapping tại Cài đặt.
              </p>
            </div>
          ))}
          {missingVoiceMappings.length === 0 && (
            <EmptyRow>Không có TTS bị chặn vì thiếu voice mapping.</EmptyRow>
          )}
        </div>
      </Section>
      <Section title="Job lỗi cứng (hard-failed)" count={failedJobs.length}>
        <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] ">
          <table className="min-w-[860px] w-full text-sm">
            <thead className="bg-[var(--surface-subtle)] text-left text-xs uppercase text-[var(--text-muted)] ">
              <tr>
                <th className="px-4 py-2">Giai đoạn</th>
                <th className="px-4 py-2">Video</th>
                <th className="px-4 py-2">Lỗi</th>
                <th className="px-4 py-2">Số lần thử lại</th>
                <th className="px-4 py-2">Tạo lúc</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {failedJobs.map((job) => (
                <tr
                  key={job.id}
                  className="border-t border-[var(--border-subtle)] "
                >
                  <td className="px-4 py-2 font-medium text-[var(--text-primary)] ">
                    {job.stage}
                  </td>
                  <td className="px-4 py-2">
                    {job.videoId ? (
                      <Link
                        href={`/videos/${job.videoId}`}
                        className="text-[var(--text-secondary)] hover:underline "
                      >
                        {job.videoTitle ?? `#${job.videoId}`}
                      </Link>
                    ) : (
                      <span className="text-[var(--text-muted)]">
                        job theo lô
                      </span>
                    )}
                  </td>
                  <td className="max-w-sm truncate px-4 py-2 text-[var(--danger)] ">
                    {job.errorMessage ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-[var(--text-secondary)] ">
                    {job.retryCount}
                  </td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">
                    {formatDateTime(job.createdAt)}
                  </td>
                  <td className="px-4 py-2">
                    <RetryJobButton jobId={job.id} />
                  </td>
                </tr>
              ))}
              {failedJobs.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-[var(--text-muted)]"
                  >
                    Không có job lỗi cứng nào. 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
      <Section
        title="Phiên bản prompt bị gắn cờ sau khi đạt giới hạn rollback"
        count={flaggedPrompts.length}
      >
        <div className="flex flex-col gap-3">
          {flaggedPrompts.map((version) => (
            <div
              key={version.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4 text-sm text-[var(--warning)] "
            >
              <span>
                <Link
                  href={`/prompts/${version.promptKey}`}
                  className="font-medium hover:underline"
                >
                  {version.promptKey} v{version.version}
                </Link>
                — tự động cập nhật đang bị tạm dừng (đã đạt giới hạn tần suất
                rollback: 1 lần / 30 ngày). Xem lại lịch sử thay đổi và tiếp tục
                từ trang prompt hoặc kích hoạt thủ công một phiên bản khác.
              </span>
            </div>
          ))}
          {flaggedPrompts.length === 0 && (
            <EmptyRow>
              Hiện không có prompt nào bị gắn cờ — tự động cập nhật đang chạy
              bình thường.
            </EmptyRow>
          )}
        </div>
      </Section>
    </div>
  );
}
