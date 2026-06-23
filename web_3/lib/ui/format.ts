const STATUS_COLORS: Record<string, string> = {
  d0_pending:        "bg-[#F2F2F7] text-[#6E6E73] border-0",
  d1_pending:        "bg-[#E5E5EA] text-[#3C3C43] border-0",
  d2a_pending:       "bg-[#E5E5EA] text-[#3C3C43] border-0",
  d2b_pending:       "bg-[#E5E5EA] text-[#3C3C43] border-0",
  d2c_pending:       "bg-[#E5E5EA] text-[#3C3C43] border-0",
  suno_pending:      "bg-[#E8F4FF] text-[#007AFF] border-0",
  d3_pending:        "bg-[#E5E5EA] text-[#3C3C43] border-0",
  d4_pending:        "bg-[#E5E5EA] text-[#3C3C43] border-0",
  ready:             "bg-[#D1F2D1] text-[#1A7A1A] border-0",
  image_gen_pending: "bg-[#E8F4FF] text-[#007AFF] border-0",
  assembly_pending:  "bg-[#F3E8FF] text-[#8B3CF7] border-0",
  assembly_done:     "bg-[#D1F2D1] text-[#1A7A1A] border-0",
  needs_attention:   "bg-[#FFE8D1] text-[#A84F0A] border-0",
  // Job statuses
  pending: "bg-[#E5E5EA] text-[#3C3C43] border-0",
  running: "bg-[#FFF3D1] text-[#FF9F0A] border-0",
  done:    "bg-[#D1F2D1] text-[#1A7A1A] border-0",
  failed:  "bg-[#FFE5E5] text-[#FF3B30] border-0",
};

export const VIDEO_STATUS_LABELS: Record<string, string> = {
  d0_pending:        "D0 · Scene",
  d1_pending:        "D1 · Visual",
  d2a_pending:       "D2 · Audio 1-5",
  d2b_pending:       "D2 · Audio 6-15",
  d2c_pending:       "D2 · Audio 16-20",
  suno_pending:      "Music",
  d3_pending:        "D3 · Thumbnail",
  d4_pending:        "D4 · Package",
  ready:             "Ready",
  image_gen_pending: "Manual Images",
  assembly_pending:  "Assembling",
  assembly_done:     "Done ✓",
  needs_attention:   "Failed",
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
