import { extractJson } from "@/lib/utils/json";

export interface AhTopic {
  title: string;
  head_keyword: string;
  angle: string;
  hook: string;
  viral_type: string;
  key_questions: string[];
}

export interface S1Selection {
  candidates: AhTopic[];
  recommendedIndex: number;
}

function fallbackHeadKeyword(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 7)
    .join(" ");
}

function normalizeTopic(value: unknown): AhTopic {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("[S1] Candidate must be an object.");
  }

  const candidate = value as Partial<AhTopic>;
  if (
    typeof candidate.title !== "string" || !candidate.title.trim()
    || typeof candidate.angle !== "string" || !candidate.angle.trim()
    || typeof candidate.hook !== "string" || !candidate.hook.trim()
    || typeof candidate.viral_type !== "string" || !candidate.viral_type.trim()
    || !Array.isArray(candidate.key_questions)
    || candidate.key_questions.length === 0
    || candidate.key_questions.some((question) => typeof question !== "string" || !question.trim())
  ) {
    throw new Error("[S1] Candidate is missing required fields.");
  }

  return {
    title: candidate.title.trim(),
    head_keyword: typeof candidate.head_keyword === "string" && candidate.head_keyword.trim()
      ? candidate.head_keyword.trim()
      : fallbackHeadKeyword(candidate.title),
    angle: candidate.angle.trim(),
    hook: candidate.hook.trim(),
    viral_type: candidate.viral_type.trim(),
    key_questions: candidate.key_questions.map((question) => question.trim()),
  };
}

export function parseS1Selection(raw: string): S1Selection {
  const parsed = extractJson<unknown>(raw);
  const legacyArray = Array.isArray(parsed);
  const candidatesValue = legacyArray
    ? parsed
    : (parsed as { candidates?: unknown })?.candidates;

  if (!Array.isArray(candidatesValue) || candidatesValue.length === 0) {
    throw new Error("[S1] Output did not contain any topic candidates.");
  }

  return {
    candidates: candidatesValue.map(normalizeTopic),
    recommendedIndex: legacyArray
      ? 1
      : Number((parsed as { recommended_index?: unknown }).recommended_index),
  };
}

export function selectS1Topic(selection: S1Selection): AhTopic {
  const index = selection.recommendedIndex - 1;
  if (Number.isInteger(selection.recommendedIndex) && selection.candidates[index]) {
    return selection.candidates[index];
  }

  console.warn(
    `[S1] Invalid recommended_index=${selection.recommendedIndex}; using the first candidate.`,
  );
  return selection.candidates[0];
}
