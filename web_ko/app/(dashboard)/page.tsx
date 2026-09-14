import Link from "next/link";

import { getKoVideoStatusCounts, listKoVideos } from "@/lib/db/repo/videos";
import { formatDate, StatusPill } from "@/lib/ui";

import { CreateVideoForm } from "./CreateVideoForm";
import { WorkerPanel } from "./WorkerPanel";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [counts, recent] = await Promise.all([getKoVideoStatusCounts(), listKoVideos({ limit: 8 })]);
  const active =
    (counts.transcribing ?? 0) +
    (counts.source_audit_pending ?? 0) +
    (counts.outline_pending ?? 0) +
    (counts.sections_pending ?? 0) +
    (counts.final_review_pending ?? 0);
  return (
    <div className="space-y-7">
      <section className="reveal grid gap-5 md:grid-cols-[1.4fr_.6fr] md:items-end">
        <div>
          <p className="eyebrow">Kênh YouTube Hàn Quốc</p>
          <h1 className="display mt-2 max-w-3xl text-4xl font-bold leading-[1.02] md:text-6xl">Biến lời kể thô thành một lời phán có khí vận.</h1>
        </div>
        <p className="muted max-w-md text-sm leading-7">Dàn ý High, từng phần High, cùng một cuộc hội thoại và không có đường lùi sang model khác.</p>
      </section>
      <CreateVideoForm />
      <WorkerPanel />
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Đang chạy" value={active} accent="pine" />
        <Stat label="Hoàn tất" value={counts.ready ?? 0} accent="gold" />
        <Stat label="Cần xử lý" value={counts.needs_attention ?? 0} accent="seal" />
      </section>
      <section className="paper-card reveal p-5 [animation-delay:140ms] md:p-7">
        <div className="mb-4 flex items-end justify-between gap-4"><div><p className="eyebrow">Gần đây</p><h2 className="display mt-1 text-2xl font-bold">Kịch bản đang lưu chuyển</h2></div><Link href="/videos" className="text-xs font-black text-[var(--pine-light)]">Xem tất cả →</Link></div>
        <div className="table-wrap"><table><thead><tr><th>Video</th><th>Trạng thái</th><th>Thời điểm</th></tr></thead><tbody>{recent.map((video) => <tr key={video.id}><td><Link href={`/videos/${video.id}`} className="font-bold hover:text-[var(--seal)]">#{video.id} {video.sourceTitle ?? video.sourceUrl}</Link></td><td><StatusPill status={video.status} /></td><td className="muted text-xs">{formatDate(video.updatedAt)}</td></tr>)}{recent.length === 0 ? <tr><td colSpan={3} className="muted py-10 text-center text-sm">Chưa có video nào.</td></tr> : null}</tbody></table></div>
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: "pine" | "gold" | "seal" }) {
  const colors = { pine: "var(--pine)", gold: "var(--gold)", seal: "var(--seal)" };
  return <div className="paper-card p-5"><p className="text-xs font-black uppercase tracking-[.12em] text-[var(--ink-soft)]">{label}</p><p className="display mt-2 text-4xl font-bold" style={{ color: colors[accent] }}>{value}</p></div>;
}
