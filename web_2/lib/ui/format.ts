const STATUS_COLORS: Record<string, string> = {
  s1_pending:      "bg-[#F2F2F7] text-[#6E6E73] border-0",
  s2_pending:      "bg-[#E5E5EA] text-[#3C3C43] border-0",
  tts_pending:     "bg-[#E5E5EA] text-[#3C3C43] border-0",
  s3_pending:      "bg-[#E5E5EA] text-[#3C3C43] border-0",
  s4_pending:      "bg-[#E5E5EA] text-[#3C3C43] border-0",
  ready:           "bg-[#D1F2D1] text-[#1A7A1A] border-0",
  needs_attention: "bg-[#FFE8D1] text-[#A84F0A] border-0",
  // Job statuses
  pending: "bg-[#E5E5EA] text-[#3C3C43] border-0",
  running: "bg-[#FFF3D1] text-[#FF9F0A] border-0",
  done:    "bg-[#D1F2D1] text-[#1A7A1A] border-0",
  failed:  "bg-[#FFE5E5] text-[#FF3B30] border-0",
};

export const VIDEO_STATUS_LABELS: Record<string, string> = {
  s1_pending:      "S1 · Topics",
  s2_pending:      "S2 · Script",
  tts_pending:     "TTS",
  s3_pending:      "S3 · Images",
  s4_pending:      "S4 · Metadata",
  ready:           "Ready",
  needs_attention: "Failed",
};

export function statusBadgeClass(status: string): string {
  return STATUS_COLORS[status] ?? "bg-[#E5E5EA] text-[#3C3C43] border-0";
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
