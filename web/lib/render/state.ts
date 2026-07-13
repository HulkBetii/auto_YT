export const MAX_RENDER_ATTEMPTS = 4;
export const RENDER_ACTIONS = ["retry", "rerender"] as const;
export type RenderAction = (typeof RENDER_ACTIONS)[number];

export function buildRenderQueueReset(requestedAt = new Date()) {
  return {
    renderStatus: "not_started" as const,
    renderError: null,
    renderAttemptCount: 0,
    renderNextAttemptAt: null,
    renderRequestedAt: requestedAt,
    renderStartedAt: null,
    renderFinishedAt: null,
    renderHeartbeatAt: null,
    renderWorkerToken: null,
  };
}

export function shouldResetRenderForAudio(
  previousAudioUrl: string | null,
  nextAudioUrl: string,
) {
  return previousAudioUrl !== nextAudioUrl;
}

export function parseRenderAction(value: unknown): RenderAction | null {
  if (!value || typeof value !== "object" || !("action" in value)) return null;
  const action = (value as { action?: unknown }).action;
  return RENDER_ACTIONS.includes(action as RenderAction)
    ? (action as RenderAction)
    : null;
}
