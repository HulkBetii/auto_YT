import {
  TTS_STATE_PRESENTATION,
  type TtsUiState,
} from "@/lib/ui/operations";

export function TtsStatusBadge({ status }: { status: TtsUiState }) {
  const item = TTS_STATE_PRESENTATION[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${item.className}`}
    >
      {item.label}
    </span>
  );
}
