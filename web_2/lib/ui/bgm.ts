export const BGM_STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  submitting: "Submitting",
  generating: "Generating",
  ready: "Ready",
  mixed: "Mixed",
  failed: "Failed",
  fallback: "Fallback",
};

export function bgmBadgeClass(status: string | null | undefined): string {
  if (status === "ready" || status === "mixed") {
    return "bg-emerald-500/10 text-emerald-300 border-emerald-400/20";
  }
  if (status === "generating" || status === "submitting") {
    return "bg-cyan-500/10 text-cyan-300 border-cyan-400/20";
  }
  if (status === "failed") {
    return "bg-red-500/10 text-red-300 border-red-400/20";
  }
  if (status === "fallback") {
    return "bg-amber-500/10 text-amber-300 border-amber-400/20";
  }
  return "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-[var(--border-subtle)]";
}

export function bgmStatusLabel(status: string | null | undefined): string {
  return BGM_STATUS_LABELS[status ?? "not_started"] ?? status ?? "Not started";
}
