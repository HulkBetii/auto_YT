import { z } from "zod";

const intString = (min: number, max: number) =>
  z.string().regex(/^\d+$/, "Must be a whole number").refine((v) => {
    const n = Number.parseInt(v, 10);
    return n >= min && n <= max;
  }, `Must be between ${min} and ${max}`);

/**
 * Editable `channel_config` key/value rows, with per-field zod validation run
 * both client- and server-side before save. `worker_heartbeat` is intentionally
 * excluded — it's written by the worker process, not edited here.
 */
export const SETTINGS_FIELDS = [
  {
    key: "channel_name",
    label: "Channel name",
    description: "Used to fill [CHANNEL_NAME] in prompt templates.",
    schema: z.string().trim().min(1).max(200),
  },
  {
    key: "p1_topics_per_batch",
    label: "P1 topics per batch",
    description: "How many candidate topics P1 generates per run.",
    schema: intString(1, 50),
  },
  {
    key: "score_threshold",
    label: "Score threshold",
    description: "Minimum P_score (0-100) to mark a video ready_to_publish; below this, it loops back to P3 for a retry.",
    schema: intString(0, 100),
  },
  {
    key: "max_content_retries",
    label: "Max content retries",
    description: "How many times a video can loop through the P3 retry cycle before being flagged needs_attention.",
    schema: intString(0, 10),
  },
  {
    key: "p6_batch_size",
    label: "P6 batch size",
    description: "How many freshly-analyzed videos accumulate before triggering a P6 prompt-strategy review.",
    schema: intString(1, 100),
  },
  {
    key: "rollback_min_views",
    label: "Rollback min. views",
    description: "View-count floor a video must cross before its analytics count toward a rollback comparison.",
    schema: intString(1, 1_000_000),
  },
  {
    key: "rollback_threshold_pct",
    label: "Rollback degradation threshold (%)",
    description: "If the new batch's average CTR drops by more than this percentage vs. the previous batch, auto-revert the prompt.",
    schema: intString(1, 100),
  },
] as const;

export type SettingsFieldKey = (typeof SETTINGS_FIELDS)[number]["key"];
