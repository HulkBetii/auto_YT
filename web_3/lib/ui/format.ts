const STATUS_COLORS: Record<string, string> = {
  d0_pending: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  d1_pending: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  d2a_pending:
    "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  d2b_pending:
    "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  d2c_pending:
    "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  suno_pending:
    "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] border-0",
  d3_pending: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  d4_pending: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  ready: "bg-[var(--success-soft)] text-[var(--success)] border-0",
  image_gen_pending:
    "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] border-0",
  assembly_pending: "bg-[var(--assembly-soft)] text-[var(--assembly)] border-0",
  assembly_done: "bg-[var(--success-soft)] text-[var(--success)] border-0",
  needs_attention: "bg-[var(--danger-soft)] text-[var(--danger)] border-0",
  // Job statuses
  pending: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  running: "bg-[var(--warning-soft)] text-[var(--warning)] border-0",
  done: "bg-[var(--success-soft)] text-[var(--success)] border-0",
  failed: "bg-[var(--danger-soft)] text-[var(--danger)] border-0",
};

export const VIDEO_STATUS_LABELS: Record<string, string> = {
  d0_pending: "D0 · Scene",
  d1_pending: "D1 · Visual",
  d2a_pending: "D2 · Audio 1-5",
  d2b_pending: "D2 · Audio 6-15",
  d2c_pending: "D2 · Audio 16-20",
  suno_pending: "Music",
  d3_pending: "D3 · Thumbnail",
  d4_pending: "D4 · Package",
  ready: "Ready",
  image_gen_pending: "Manual Assets",
  assembly_pending: "Assembling",
  assembly_done: "Done ✓",
  needs_attention: "Failed",
};

export function statusBadgeClass(status: string): string {
  return (
    STATUS_COLORS[status] ??
    "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0"
  );
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}
