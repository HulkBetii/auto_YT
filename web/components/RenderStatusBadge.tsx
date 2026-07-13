type RenderStatusBadgeProps = {
  audioUrl: string | null;
  renderStatus: string;
};

export function RenderStatusBadge({
  audioUrl,
  renderStatus,
}: RenderStatusBadgeProps) {
  const state = !audioUrl ? "waiting_audio" : renderStatus;
  const presentation: Record<string, { label: string; className: string }> = {
    waiting_audio: {
      label: "Chờ audio",
      className: "bg-[var(--surface-muted)] text-[var(--text-secondary)]",
    },
    not_started: {
      label: "Đang chờ",
      className: "bg-[var(--warning-soft)] text-[var(--warning)]",
    },
    rendering: {
      label: "Đang render",
      className: "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)]",
    },
    done: {
      label: "Hoàn tất",
      className: "bg-[var(--success-soft)] text-[var(--success)]",
    },
    failed: {
      label: "Thất bại",
      className: "bg-[var(--danger-soft)] text-[var(--danger)]",
    },
  };
  const item = presentation[state] ?? presentation.waiting_audio;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${item.className}`}
    >
      {item.label}
    </span>
  );
}
