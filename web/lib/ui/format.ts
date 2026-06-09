// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  // Video statuses
  ready_to_publish: "bg-[#D1F2D1] text-[#1A7A1A] border-0",
  published:        "bg-[#D1E8FF] text-[#0A52A8] border-0",
  needs_attention:  "bg-[#FFE8D1] text-[#A84F0A] border-0",
  needs_retry:      "bg-[#FFE8D1] text-[#A84F0A] border-0",
  scoring:          "bg-[#E5E5EA] text-[#3C3C43] border-0",
  topic:            "bg-[#F2F2F7] text-[#6E6E73] border-0",
  outline:          "bg-[#F2F2F7] text-[#6E6E73] border-0",
  scripted:         "bg-[#E5E5EA] text-[#3C3C43] border-0",
  seo_done:         "bg-[#E5E5EA] text-[#3C3C43] border-0",
  analyzed:         "bg-[#E5E5EA] text-[#3C3C43] border-0",
  // Job statuses
  pending: "bg-[#E5E5EA] text-[#3C3C43] border-0",
  running: "bg-[#FFF3D1] text-[#FF9F0A] border-0",
  done:    "bg-[#D1F2D1] text-[#1A7A1A] border-0",
  failed:  "bg-[#FFE5E5] text-[#FF3B30] border-0",
};

export const STATUS_LABELS: Record<string, string> = {
  ready_to_publish: "Ready",
  published:        "Published",
  needs_attention:  "Needs review",
  needs_retry:      "Retry",
  scoring:          "Scoring",
  topic:            "Topic",
  outline:          "Outline",
  scripted:         "Scripted",
  seo_done:         "SEO done",
  analyzed:         "Analyzed",
  pending:          "Pending",
  running:          "Running",
  done:             "Done",
  failed:           "Failed",
};

export function statusBadgeClass(status: string): string {
  return STATUS_COLORS[status] ?? "bg-[#E5E5EA] text-[#3C3C43] border-0";
}

// ── Score color ───────────────────────────────────────────────────────────────

export function scoreColorClass(score: number | null | undefined): string {
  if (score == null) return "text-[#AEAEB2]";
  if (score >= 85) return "text-[#34C759]";
  if (score >= 70) return "text-[#FF9F0A]";
  return "text-[#FF3B30]";
}

// ── Date / time ───────────────────────────────────────────────────────────────

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
}

export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "vừa xong";
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} giờ trước`;
  return `${Math.round(diffHr / 24)} ngày trước`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}
