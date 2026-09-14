import Link from "next/link";
import { notFound } from "next/navigation";

import { getKoVideo, listKoJobsByVideo, listKoSections } from "@/lib/db/repo/videos";
import { formatDate, StatusPill } from "@/lib/ui";

import { CopyScriptButton } from "../../CopyScriptButton";
import { RetryButton } from "../../RetryButton";

type OutlineView = { raw_text?: string };
type SectionOutlineView = { internal_name?: string; raw_text?: string; source_fact_ids?: string[] };
type SourceAuditView = {
  primary_topic?: string;
  boundary_reason?: string;
  keep_start_segment?: number;
  keep_end_segment?: number;
  kept_start_ms?: number;
  kept_end_ms?: number;
  original_segment_count?: number;
  kept_segment_count?: number;
  excluded_topics?: Array<{ start_segment: number; end_segment: number; topic: string; reason: string }>;
  required_facts?: Array<{
    id: string;
    category: string;
    disposition: string;
    meaning_ko: string;
    source_segments: number[];
  }>;
};
type FidelityReviewView = {
  verdict?: string;
  summary_ko?: string;
  review_cycle?: number;
  missing_fact_ids?: string[];
};

export const dynamic = "force-dynamic";

export default async function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const videoId = Number((await params).id);
  const video = Number.isInteger(videoId) ? await getKoVideo(videoId) : null;
  if (!video) notFound();
  const [sections, jobs] = await Promise.all([listKoSections(video.id), listKoJobsByVideo(video.id)]);
  const outline = video.outline as OutlineView | null;
  const sourceAudit = video.sourceAudit as SourceAuditView | null;
  const fidelityReview = video.fidelityReview as FidelityReviewView | null;

  return (
    <div className="space-y-6">
      <header className="reveal">
        <Link href="/videos" className="muted text-xs font-bold">← Quay lại kho</Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <p className="eyebrow">Project #{video.id}</p>
            <h1 className="display mt-2 text-4xl font-bold leading-tight">{video.sourceTitle ?? "Đang lấy tiêu đề nguồn"}</h1>
            <a className="muted mt-3 block break-all text-xs hover:text-[var(--seal)]" href={video.sourceUrl} target="_blank" rel="noreferrer">{video.sourceUrl}</a>
          </div>
          <StatusPill status={video.status} />
        </div>
      </header>

      {video.status === "needs_attention" ? (
        <section className="paper-card border-[var(--seal)] p-6">
          <p className="eyebrow">{video.errorCode ?? "Lỗi pipeline"}</p>
          <p className="my-4 text-sm font-bold leading-6 text-[var(--seal-dark)]">{video.errorMessage}</p>
          <RetryButton videoId={video.id} />
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <Info label="Transcript sạch" value={video.transcriptLanguage ? `${video.transcriptLanguage} · ${video.transcriptHash?.slice(0, 10) ?? "đang audit"}` : "Chưa sẵn sàng"} />
        <Info label="Hội thoại" value={video.conversationUrl ? "Đã lưu" : "Chưa tạo"} link={video.conversationUrl} />
        <Info label="Cập nhật" value={formatDate(video.updatedAt)} />
      </section>

      {sourceAudit ? <SourceAuditPanel audit={sourceAudit} /> : null}

      {video.finalScript ? (
        <section className="paper-card p-6 md:p-8">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div><p className="eyebrow">Thành phẩm đã qua fidelity review</p><h2 className="display mt-1 text-3xl font-bold">Kịch bản TTS-ready</h2></div>
            <div className="flex gap-2"><CopyScriptButton script={video.finalScript} /><a className="button-primary" href={`/api/videos/${video.id}/download`}>Tải TXT</a></div>
          </div>
          <div className="whitespace-pre-wrap text-[15px] leading-8">{video.finalScript}</div>
        </section>
      ) : null}

      {video.rawTranscriptText ? (
        <section className="paper-card p-6"><details><summary className="cursor-pointer font-black">Transcript gốc chưa cắt</summary><div className="code-block mt-4">{video.rawTranscriptText}</div></details></section>
      ) : null}
      <section className="paper-card p-6"><details open={!video.finalScript}><summary className="cursor-pointer font-black">Transcript sạch dùng để viết</summary><div className="code-block mt-4">{video.transcriptText ?? "Transcript chưa sẵn sàng."}</div></details></section>
      <section className="paper-card p-6"><details open><summary className="cursor-pointer font-black">Dàn ý chi tiết</summary><div className="code-block mt-4">{outline?.raw_text ?? "Dàn ý chưa sẵn sàng."}</div></details></section>

      <section className="space-y-3">
        <div><p className="eyebrow">Phân đoạn</p><h2 className="display mt-1 text-3xl font-bold">Mạch kịch bản</h2></div>
        {sections.map((section) => {
          const sectionOutline = section.outlineData as SectionOutlineView;
          return (
            <article key={section.id} className="paper-card p-5 md:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><span className="eyebrow">Phần {section.sectionIndex}</span><h3 className="display text-xl font-bold">{sectionOutline.internal_name ?? section.kind}</h3><p className="muted mt-1 text-[11px]">{sectionOutline.source_fact_ids?.join(", ") || "Không có fact bắt buộc"}</p></div>
                <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px] font-black">{section.status}</span>
              </div>
              {section.body ? <p className="whitespace-pre-wrap text-sm leading-7">{section.body}</p> : <div className="muted text-xs">{section.validationErrors ? JSON.stringify(section.validationErrors) : sectionOutline.raw_text ?? "Đang chờ xử lý."}</div>}
            </article>
          );
        })}
        {sections.length === 0 ? <div className="paper-card muted p-8 text-center text-sm">Chưa có section.</div> : null}
      </section>

      {fidelityReview ? (
        <section className="paper-card p-6">
          <p className="eyebrow">Fidelity review · vòng {fidelityReview.review_cycle ?? 0}</p>
          <h2 className="display mt-1 text-2xl font-bold">{fidelityReview.verdict === "pass" ? "Đã giữ đủ ý nguồn" : "Đang sửa theo đối chiếu nguồn"}</h2>
          <p className="mt-3 text-sm leading-7">{fidelityReview.summary_ko}</p>
          {fidelityReview.missing_fact_ids?.length ? <p className="mt-3 text-xs font-black text-[var(--seal)]">Thiếu: {fidelityReview.missing_fact_ids.join(", ")}</p> : null}
        </section>
      ) : null}

      <section className="paper-card p-6">
        <details><summary className="cursor-pointer font-black">Lịch sử job ({jobs.length})</summary><div className="table-wrap mt-4"><table><thead><tr><th>Job</th><th>Loại</th><th>Model</th><th>Trạng thái</th><th>Lỗi</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td>#{job.id}</td><td>{job.kind}{job.sectionId ? ` · section ${job.sectionId}` : ""}</td><td>{job.modelLabel} / {job.effort}</td><td>{job.status} · repair {job.validationAttempt}</td><td className="max-w-sm text-xs text-[var(--seal-dark)]">{job.errorMessage ?? "—"}</td></tr>)}</tbody></table></div></details>
      </section>
    </div>
  );
}

function SourceAuditPanel({ audit }: { audit: SourceAuditView }) {
  const keptRange = audit.kept_start_ms != null && audit.kept_end_ms != null
    ? `${formatDuration(audit.kept_start_ms)}–${formatDuration(audit.kept_end_ms)}`
    : `segment ${audit.keep_start_segment ?? "?"}–${audit.keep_end_segment ?? "?"}`;
  return (
    <section className="paper-card p-6">
      <p className="eyebrow">Source audit</p>
      <h2 className="display mt-1 text-2xl font-bold">{audit.primary_topic}</h2>
      <p className="mt-3 text-sm leading-7">Giữ {keptRange} · {audit.kept_segment_count ?? "?"}/{audit.original_segment_count ?? "?"} segment. {audit.boundary_reason}</p>
      {audit.excluded_topics?.map((topic) => <p key={`${topic.start_segment}-${topic.end_segment}`} className="mt-2 text-xs font-bold text-[var(--seal)]">Loại segment {topic.start_segment}–{topic.end_segment}: {topic.topic} · {topic.reason}</p>)}
      <div className="table-wrap mt-5"><table><thead><tr><th>Fact</th><th>Loại</th><th>Xử lý</th><th>Ý nguồn</th></tr></thead><tbody>{audit.required_facts?.map((fact) => <tr key={fact.id}><td className="font-black">{fact.id}</td><td>{fact.category}</td><td>{fact.disposition}</td><td className="min-w-80 text-xs leading-5">{fact.meaning_ko}</td></tr>)}</tbody></table></div>
    </section>
  );
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Info({ label, value, link }: { label: string; value: string; link?: string | null }) {
  return <div className="paper-card p-5"><p className="eyebrow">{label}</p>{link ? <a href={link} target="_blank" rel="noreferrer" className="mt-2 block text-sm font-black text-[var(--pine-light)]">{value} ↗</a> : <p className="mt-2 text-sm font-black">{value}</p>}</div>;
}
