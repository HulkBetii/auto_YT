import { MAX_RENDER_ATTEMPTS } from "@/lib/render/state";

export type TtsUiState =
  | "waiting_submit"
  | "submitted"
  | "running"
  | "done"
  | "no_mapping";

export type TtsCycleState =
  | "completed"
  | "submitted"
  | "running"
  | "blocked"
  | "retrying"
  | "failed";

export function classifyTtsCycleResult(result: {
  ok: boolean;
  error?: string;
}): TtsCycleState {
  if (result.ok) return "completed";
  if (result.error === "submitted") return "submitted";
  if (result.error === "running") return "running";
  if (result.error === "no_voice_mapping") return "blocked";
  if (result.error?.startsWith("stale_cancelled")) return "retrying";
  return "failed";
}

export const TTS_STATE_PRESENTATION: Record<
  TtsUiState,
  { label: string; className: string }
> = {
  waiting_submit: {
    label: "Chờ gửi TTS",
    className: "bg-[var(--warning-soft)] text-[var(--warning)]",
  },
  submitted: {
    label: "Đã gửi TTS",
    className: "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)]",
  },
  running: {
    label: "Đang tạo audio",
    className: "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)]",
  },
  done: {
    label: "Audio xong",
    className: "bg-[var(--success-soft)] text-[var(--success)]",
  },
  no_mapping: {
    label: "Thiếu voice",
    className: "bg-[var(--danger-soft)] text-[var(--danger)]",
  },
};

export type RenderUiState =
  | "waiting_audio"
  | "blocked_missing_text"
  | "queued"
  | "queued_old_output"
  | "retry_scheduled"
  | "rendering"
  | "rendering_old_output"
  | "done"
  | "stale_output"
  | "failed"
  | "failed_old_output";

export function deriveRenderUiState(input: {
  audioUrl: string | null;
  ttsText?: string | null;
  renderStatus: string;
  renderAttemptCount?: number;
  renderNextAttemptAt?: string | Date | null;
  outputAvailable?: boolean;
  outputCurrent?: boolean;
}): RenderUiState {
  const outputAvailable = Boolean(input.outputAvailable);
  if (!input.audioUrl) return "waiting_audio";
  if (input.ttsText !== undefined && !input.ttsText) {
    return "blocked_missing_text";
  }
  if (input.renderStatus === "rendering") {
    return outputAvailable ? "rendering_old_output" : "rendering";
  }
  if (input.renderStatus === "failed") {
    const retryScheduled =
      (input.renderAttemptCount ?? 0) < MAX_RENDER_ATTEMPTS &&
      Boolean(input.renderNextAttemptAt);
    if (retryScheduled) return "retry_scheduled";
    return outputAvailable ? "failed_old_output" : "failed";
  }
  if (input.renderStatus === "done") {
    if (outputAvailable && input.outputCurrent !== false) return "done";
    if (outputAvailable) return "stale_output";
    return "failed";
  }
  return outputAvailable ? "queued_old_output" : "queued";
}

export const RENDER_STATE_PRESENTATION: Record<
  RenderUiState,
  { label: string; className: string }
> = {
  waiting_audio: {
    label: "Chờ audio",
    className: "bg-[var(--surface-muted)] text-[var(--text-secondary)]",
  },
  blocked_missing_text: {
    label: "Thiếu text TTS",
    className: "bg-[var(--danger-soft)] text-[var(--danger)]",
  },
  queued: {
    label: "Đã xếp hàng",
    className: "bg-[var(--warning-soft)] text-[var(--warning)]",
  },
  queued_old_output: {
    label: "Xếp hàng · giữ bản cũ",
    className: "bg-[var(--warning-soft)] text-[var(--warning)]",
  },
  retry_scheduled: {
    label: "Chờ retry",
    className: "bg-[var(--warning-soft)] text-[var(--warning)]",
  },
  rendering: {
    label: "Đang render",
    className: "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)]",
  },
  rendering_old_output: {
    label: "Render · giữ bản cũ",
    className: "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)]",
  },
  done: {
    label: "Render xong",
    className: "bg-[var(--success-soft)] text-[var(--success)]",
  },
  stale_output: {
    label: "Bản cũ",
    className: "bg-[var(--warning-soft)] text-[var(--warning)]",
  },
  failed: {
    label: "Render lỗi",
    className: "bg-[var(--danger-soft)] text-[var(--danger)]",
  },
  failed_old_output: {
    label: "Lỗi · còn bản cũ",
    className: "bg-[var(--danger-soft)] text-[var(--danger)]",
  },
};
