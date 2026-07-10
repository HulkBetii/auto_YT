const ADAPTIVE_LABELS: Record<string, string> = {
  BEHAVIOR_DECODING: "Behavior decoding",
  HIDDEN_SIGN: "Hidden sign",
  RITUAL_LUCK: "Ritual luck",
  WARNING_CONTRAST: "Warning contrast",
  AGE_LIFE: "Age life",
  PAIN_RELEASE: "Pain release",
  OBSERVER: "Observer",
  DECODER: "Decoder",
  COUNSELOR: "Counselor",
  AUTOBIOGRAPHICAL: "Autobiographical",
  DIAGNOSTIC_QUESTION: "Diagnostic question",
  DIRECT_WARNING: "Direct warning",
  SECRET_REVEAL: "Secret reveal",
  CONTRARIAN_STATEMENT: "Contrarian",
  FUTURE_REGRET: "Future regret",
  BIG_PROMISE: "Big promise",
  SELF_RECOGNITION: "Self recognition",
  DISCUSSION: "Discussion",
  IDENTITY_DECLARATION: "Identity declaration",
  GRATITUDE_RITUAL: "Gratitude ritual",
  COMMITMENT: "Commitment",
};

export function formatAdaptiveLabel(value: string | null | undefined): string {
  if (!value) return "-";
  return (
    ADAPTIVE_LABELS[value] ??
    value
      .split("_")
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
      .join(" ")
  );
}

export function formatListCount(value: number | null | undefined): string {
  return value != null ? `${value} items` : "-";
}
