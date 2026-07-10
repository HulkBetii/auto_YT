const STATUS_COLORS: Record<string, string> = {
  s1_pending: "bg-[var(--dashboard-bg)] text-[var(--text-muted)] border-0",
  s2_pending: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  tts_pending:
    "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  s3_pending: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
  s4_pending: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0",
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
  s1_pending: "S1 · Topics",
  s2_pending: "S2 · Script",
  tts_pending: "TTS",
  s3_pending: "S3 · Img Prompts",
  s4_pending: "S4 · Metadata",
  ready: "Ready",
  image_gen_pending: "Manual Images",
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
