// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  // Video statuses
  ready_to_publish: "bg-[var(--success-soft)] text-[var(--success)] border-0",
  published: "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] border-0",
  needs_attention: "bg-[var(--danger-soft)] text-[var(--danger)] border-0",
  needs_retry: "bg-[var(--danger-soft)] text-[var(--danger)] border-0",
  scoring: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  topic: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  outline: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  scripted: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  seo_done: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  analyzed: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  // Job statuses
  pending: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  running: "bg-[var(--warning-soft)] text-[var(--warning)] border-0",
  done: "bg-[var(--success-soft)] text-[var(--success)] border-0",
  failed: "bg-[var(--danger-soft)] text-[var(--danger)] border-0",
};

export const STATUS_LABELS: Record<string, string> = {
  ready_to_publish: "Ready",
  published: "Published",
  needs_attention: "Needs review",
  needs_retry: "Retry",
  scoring: "Scoring",
  topic: "Topic",
  outline: "Outline",
  scripted: "Scripted",
  seo_done: "SEO done",
  analyzed: "Analyzed",
  pending: "Pending",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

export function statusBadgeClass(status: string): string {
  return (
    STATUS_COLORS[status] ??
    "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0"
  );
}

// ── Score color ───────────────────────────────────────────────────────────────

export function scoreColorClass(score: number | null | undefined): string {
  if (score == null) return "text-[var(--text-secondary)]";
  if (score >= 85) return "text-[var(--success)]";
  if (score >= 70) return "text-[var(--warning)]";
  return "text-[var(--danger)]";
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
