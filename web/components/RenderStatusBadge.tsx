import {
  deriveRenderUiState,
  RENDER_STATE_PRESENTATION,
} from "@/lib/ui/operations";

type RenderStatusBadgeProps = {
  audioUrl: string | null;
  ttsText?: string | null;
  renderStatus: string;
  renderAttemptCount?: number;
  renderNextAttemptAt?: string | Date | null;
  outputAvailable?: boolean;
  outputCurrent?: boolean;
};

export function RenderStatusBadge({
  audioUrl,
  ttsText,
  renderStatus,
  renderAttemptCount,
  renderNextAttemptAt,
  outputAvailable,
  outputCurrent,
}: RenderStatusBadgeProps) {
  const state = deriveRenderUiState({
    audioUrl,
    ttsText,
    renderStatus,
    renderAttemptCount,
    renderNextAttemptAt,
    outputAvailable,
    outputCurrent,
  });
  const item = RENDER_STATE_PRESENTATION[state];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${item.className}`}
    >
      {item.label}
    </span>
  );
}
