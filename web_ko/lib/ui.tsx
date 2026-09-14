export const STATUS_LABELS: Record<string, string> = {
  transcript_pending: "Chờ transcript",
  transcribing: "Đang lấy transcript",
  source_audit_pending: "Đang kiểm tra nguồn",
  outline_pending: "Đang tạo dàn ý",
  sections_pending: "Đang viết kịch bản",
  final_review_pending: "Đang đối chiếu bản cuối",
  ready: "Hoàn tất",
  needs_attention: "Cần xử lý",
};

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "ready"
      ? "border-emerald-800/20 bg-emerald-700/10 text-emerald-900"
      : status === "needs_attention"
        ? "border-red-800/20 bg-red-700/10 text-red-900"
        : "border-amber-800/20 bg-amber-700/10 text-amber-950";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black ${tone}`}>{STATUS_LABELS[status] ?? status}</span>;
}
