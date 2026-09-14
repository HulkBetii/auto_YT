import { z } from "zod";

const HANGUL_PATTERN = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
const HANGUL_GLOBAL_PATTERN = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g;
const ARABIC_DIGIT_PATTERN = /[0-9]/;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const FACT_ID_PATTERN = /\[?(F\d{3})\]?/g;
const EXPLICIT_TOPIC_TRANSITION_PATTERN =
  /(그리고\s+)?이어서\s+다음\s+주제|다음\s+주제를\s+(공유|소개)|이제\s+다음\s+주제/;

const BANNED_PHRASES = [
  "미신일 수도",
  "과학적 근거는 없지만",
  "믿거나 말거나",
  "개인차가 있습니다",
  "참고만 하십시오",
  "팔괘",
  "바구아",
  "비휴",
  "픽시우",
  "삼족두꺼비",
  "금전수",
  "일본",
  "미국",
  "북미",
  "캐나다",
  "유럽",
  "서양",
];

const SHOCK_OPENINGS = [
  "충격적인 사실",
  "당신은 지금도 재물을 버리고 있습니다",
  "부자들은 절대 말해주지 않습니다",
  "구십 퍼센트가 모르는",
];

const outlineSectionSchema = z.object({
  index: z.number().int().positive(),
  kind: z.enum(["hook", "secret", "closing"]),
  internal_name: z.string().min(1),
  points: z.array(z.string().min(1)).min(1),
  raw_text: z.string().min(1),
  source_fact_ids: z.array(z.string().regex(/^F\d{3}$/)),
});

const outlineSchema = z.object({
  raw_text: z.string().min(1),
  sections: z.array(outlineSectionSchema).min(3),
});

export type KoOutlineSection = z.infer<typeof outlineSectionSchema>;
export type KoOutline = z.infer<typeof outlineSchema>;

const sourceFactSchema = z.object({
  id: z.string().regex(/^F\d{3}$/),
  category: z.string().min(1),
  disposition: z.enum(["preserve", "localize", "omit"]),
  meaning_ko: z.string().min(1),
  source_segments: z.array(z.number().int().positive()).min(1),
});

const sourceAuditSchema = z.object({
  primary_topic: z.string().min(1),
  keep_start_segment: z.number().int().positive(),
  keep_end_segment: z.number().int().positive(),
  boundary_confidence: z.enum(["high", "ambiguous"]),
  boundary_reason: z.string().min(1),
  excluded_topics: z.array(
    z.object({
      start_segment: z.number().int().positive(),
      end_segment: z.number().int().positive(),
      topic: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
  required_facts: z.array(sourceFactSchema).min(1),
});

const fidelityIssueSchema = z.object({
  section_index: z.number().int().positive(),
  description_ko: z.string().min(1),
});

const fidelityReviewSchema = z.object({
  verdict: z.enum(["pass", "repair"]),
  summary_ko: z.string().min(1),
  missing_fact_ids: z.array(z.string().regex(/^F\d{3}$/)),
  contradictions: z.array(fidelityIssueSchema),
  unrelated_topic_intrusions: z.array(fidelityIssueSchema),
  repairs: z.array(
    z.object({
      section_index: z.number().int().positive(),
      instructions_ko: z.string().min(1),
      required_fact_ids: z.array(z.string().regex(/^F\d{3}$/)),
    }),
  ),
});

export type SourceFact = z.infer<typeof sourceFactSchema>;
export type SourceAudit = z.infer<typeof sourceAuditSchema>;
export type FidelityReview = z.infer<typeof fidelityReviewSchema>;
export type TranscriptSegmentInput = { index: number; startMs: number; endMs: number; text: string };

export type ValidationResult<T> =
  | { ok: true; value: T; errors: [] }
  | { ok: false; value: null; errors: string[] };

function getBannedTerms(value: string): string[] {
  return BANNED_PHRASES.filter((phrase) => value.includes(phrase));
}

function cleanMarkdown(value: string): string {
  return value
    .trim()
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^__(.+)__$/, "$1")
    .replace(/\s+source$/i, "")
    .trim();
}

function parseStrictJson(value: string): unknown {
  const normalized = value.trim();
  if (/```/.test(normalized)) throw new Error("JSON output must not use code fences.");
  return JSON.parse(normalized);
}

function parseNumberedOutline(value: string): KoOutline {
  const normalized = value.trim().replace(/\r\n/g, "\n");
  if (!normalized) throw new Error("Outline is empty.");
  if (/```/.test(normalized)) throw new Error("Outline must not use code fences.");

  const parsed: Array<{ index: number; internal_name: string; points: string[]; source_fact_ids: string[] }> = [];
  let current: { index: number; internal_name: string; points: string[]; source_fact_ids: string[] } | null = null;

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^(?:#{1,6}\s*)?(?:\*\*)?(\d+)[.)]\s+(.+?)(?:\*\*)?$/);
    if (heading) {
      if (current) parsed.push(current);
      current = {
        index: Number(heading[1]),
        internal_name: cleanMarkdown(heading[2]),
        points: [],
        source_fact_ids: [],
      };
      continue;
    }
    if (!current) continue;
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    const point = cleanMarkdown(bullet?.[1] ?? line);
    const factIds = [...point.matchAll(FACT_ID_PATTERN)].map((match) => match[1]);
    current.source_fact_ids.push(...factIds);
    current.points.push(point.replace(FACT_ID_PATTERN, "").replace(/\s{2,}/g, " ").trim());
  }
  if (current) parsed.push(current);
  if (parsed.length < 3) {
    throw new Error("Outline must contain at least three numbered sections with bullet points.");
  }

  const sections = parsed.map((section, offset): KoOutlineSection => {
    const kind = offset === 0 ? "hook" : offset === parsed.length - 1 ? "closing" : "secret";
    return {
      ...section,
      kind,
      raw_text: [
        `${section.index}. ${section.internal_name}`,
        ...section.points.map((point) => `- ${point}`),
      ].join("\n"),
    };
  });
  return outlineSchema.parse({
    raw_text: sections.map((section) => section.raw_text).join("\n\n"),
    sections,
  });
}

export function validateOutline(value: string, sourceFacts: SourceFact[] = []): ValidationResult<KoOutline> {
  let outline: KoOutline;
  try {
    outline = parseNumberedOutline(value);
  } catch (error) {
    return { ok: false, value: null, errors: [error instanceof Error ? error.message : String(error)] };
  }

  const errors: string[] = [];
  for (const [offset, section] of outline.sections.entries()) {
    if (section.index !== offset + 1) errors.push(`Section index ${section.index} is not contiguous.`);
    if (section.points.length === 0) errors.push(`Section ${section.index} must contain bullet points.`);
    if (!HANGUL_PATTERN.test(section.internal_name) || section.points.some((point) => !HANGUL_PATTERN.test(point))) {
      errors.push(`Section ${section.index} must be written in Korean.`);
    }
  }
  const letters = outline.raw_text.match(/\p{L}/gu) ?? [];
  const hangulRatio = letters.length === 0 ? 0 : (outline.raw_text.match(HANGUL_GLOBAL_PATTERN) ?? []).length / letters.length;
  if (hangulRatio < 0.7) errors.push(`Outline Hangul ratio ${hangulRatio.toFixed(2)} is below 0.70.`);
  const banned = getBannedTerms(outline.raw_text);
  if (banned.length > 0) errors.push(`Outline contains banned terms: ${banned.join(", ")}.`);

  if (sourceFacts.length > 0) {
    const expected = new Set(
      sourceFacts.filter((fact) => fact.disposition !== "omit").map((fact) => fact.id),
    );
    const counts = new Map<string, number>();
    for (const section of outline.sections) {
      for (const factId of section.source_fact_ids) {
        counts.set(factId, (counts.get(factId) ?? 0) + 1);
        if (!expected.has(factId)) errors.push(`Outline references unknown or omitted fact ${factId}.`);
      }
    }
    for (const factId of expected) {
      const count = counts.get(factId) ?? 0;
      if (count === 0) errors.push(`Outline is missing required source fact ${factId}.`);
      if (count > 1) errors.push(`Outline assigns source fact ${factId} more than once.`);
    }
  }

  return errors.length > 0
    ? { ok: false, value: null, errors }
    : { ok: true, value: outline, errors: [] };
}

export function validateSourceAudit(
  value: string,
  segments: TranscriptSegmentInput[],
): ValidationResult<SourceAudit> {
  let audit: SourceAudit;
  try {
    audit = sourceAuditSchema.parse(parseStrictJson(value));
  } catch (error) {
    return { ok: false, value: null, errors: [error instanceof Error ? error.message : String(error)] };
  }

  const errors: string[] = [];
  const indexes = new Set(segments.map((segment) => segment.index));
  if (audit.boundary_confidence !== "high") errors.push("Source topic boundary is ambiguous.");
  if (audit.keep_start_segment > audit.keep_end_segment) errors.push("Source keep range is reversed.");
  if (!indexes.has(audit.keep_start_segment) || !indexes.has(audit.keep_end_segment)) {
    errors.push("Source keep range references missing segments.");
  }
  const keptCount = segments.filter(
    (segment) => segment.index >= audit.keep_start_segment && segment.index <= audit.keep_end_segment,
  ).length;
  if (keptCount < 20) errors.push("Source keep range is too short to outline safely.");
  const keptTransition = segments.find(
    (segment) =>
      segment.index >= audit.keep_start_segment &&
      segment.index <= audit.keep_end_segment &&
      EXPLICIT_TOPIC_TRANSITION_PATTERN.test(segment.text),
  );
  if (keptTransition) {
    errors.push(
      `Source keep range includes an explicit topic transition at segment ${keptTransition.index}.`,
    );
  }

  const seenFacts = new Set<string>();
  for (const [offset, fact] of audit.required_facts.entries()) {
    const expectedId = `F${String(offset + 1).padStart(3, "0")}`;
    if (fact.id !== expectedId) errors.push(`Source fact IDs must be contiguous; expected ${expectedId}.`);
    if (seenFacts.has(fact.id)) errors.push(`Duplicate source fact ${fact.id}.`);
    seenFacts.add(fact.id);
    if (
      fact.source_segments.some(
        (index) =>
          !indexes.has(index) || index < audit.keep_start_segment || index > audit.keep_end_segment,
      )
    ) {
      errors.push(`Source fact ${fact.id} references a segment outside the kept range.`);
    }
  }
  for (const excluded of audit.excluded_topics) {
    if (excluded.start_segment > excluded.end_segment) errors.push("Excluded topic range is reversed.");
    if (!indexes.has(excluded.start_segment) || !indexes.has(excluded.end_segment)) {
      errors.push("Excluded topic references missing segments.");
    }
  }

  return errors.length > 0
    ? { ok: false, value: null, errors }
    : { ok: true, value: audit, errors: [] };
}

export function validateFidelityReview(
  value: string,
  sourceFacts: SourceFact[],
  sectionIndexes: number[],
): ValidationResult<FidelityReview> {
  let review: FidelityReview;
  try {
    review = fidelityReviewSchema.parse(parseStrictJson(value));
  } catch (error) {
    return { ok: false, value: null, errors: [error instanceof Error ? error.message : String(error)] };
  }

  const errors: string[] = [];
  const validFacts = new Set(
    sourceFacts.filter((fact) => fact.disposition !== "omit").map((fact) => fact.id),
  );
  const validSections = new Set(sectionIndexes);
  const referencedFacts = new Set([
    ...review.missing_fact_ids,
    ...review.repairs.flatMap((repair) => repair.required_fact_ids),
  ]);
  for (const factId of referencedFacts) {
    if (!validFacts.has(factId)) errors.push(`Fidelity review references unknown fact ${factId}.`);
  }
  for (const issue of [
    ...review.contradictions,
    ...review.unrelated_topic_intrusions,
    ...review.repairs,
  ]) {
    if (!validSections.has(issue.section_index)) {
      errors.push(`Fidelity review references unknown section ${issue.section_index}.`);
    }
  }
  if (review.verdict === "pass") {
    if (
      review.missing_fact_ids.length > 0 ||
      review.contradictions.length > 0 ||
      review.unrelated_topic_intrusions.length > 0 ||
      review.repairs.length > 0
    ) {
      errors.push("A passing fidelity review must not contain issues or repairs.");
    }
  } else if (review.repairs.length === 0) {
    errors.push("A repair fidelity review must include targeted repairs.");
  }
  const repairFacts = new Set(review.repairs.flatMap((repair) => repair.required_fact_ids));
  for (const factId of review.missing_fact_ids) {
    if (!repairFacts.has(factId)) errors.push(`Missing fact ${factId} is not assigned to a repair.`);
  }

  return errors.length > 0
    ? { ok: false, value: null, errors }
    : { ok: true, value: review, errors: [] };
}

function splitSentences(value: string): string[] {
  const matches = value.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

function hangulCount(value: string): number {
  return (value.match(HANGUL_GLOBAL_PATTERN) ?? []).length;
}

function hasConsequence(value: string): boolean {
  const conditional = /(무시|외면|따르지|지키지|하지 않|버려두|놓치|방치)/;
  const negative = /(막힙|끊깁|떠납|무너집|잃|고갈|쌓입|가난|화가|새어|빠져나|복이 달아)/;
  return conditional.test(value) && negative.test(value);
}

function hasConcreteKoreanNumber(value: string): boolean {
  return /(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|삼십|백|천|만|첫|둘째|셋째)\s*(번|개|장|분|시|일|개월|그릇|숟가락|층|줌)/.test(
    value,
  );
}

export function validateSectionText(
  value: string,
  section: Pick<KoOutlineSection, "index" | "kind">,
): ValidationResult<string> {
  const text = value.trim();
  const errors: string[] = [];
  if (!text) return { ok: false, value: null, errors: ["Section output is empty."] };
  if (/^\s*(#{1,6}|[-*•]|\d+[.)])\s+/m.test(text)) errors.push("Headings or list markers are forbidden.");
  if (/[“”‘’「」『』"]/.test(text)) errors.push("Decorative quotation marks are forbidden.");
  if (EMOJI_PATTERN.test(text)) errors.push("Emoji are forbidden.");
  if (ARABIC_DIGIT_PATTERN.test(text)) errors.push("Arabic digits are forbidden; use Korean number words.");
  if (/\bF\d{3}\b/.test(text)) errors.push("Internal source fact IDs must not appear in the script.");
  if (!text.includes("당신")) errors.push("The section must contain 당신.");
  if (!text.includes("정성")) errors.push("The section must contain 정성.");
  if (!text.includes("지금 즉시") && !text.includes("오늘 당장")) {
    errors.push("The section must contain 지금 즉시 or 오늘 당장.");
  }
  const banned = getBannedTerms(text);
  if (banned.length > 0) errors.push(`Banned terms found: ${banned.join(", ")}.`);

  const letters = text.match(/\p{L}/gu) ?? [];
  const ratio = letters.length === 0 ? 0 : hangulCount(text) / letters.length;
  if (ratio < 0.7) errors.push(`Hangul ratio ${ratio.toFixed(2)} is below 0.70.`);

  const sentences = splitSentences(text);
  if (sentences.length === 0) errors.push("No complete sentence found.");
  for (const [offset, sentence] of sentences.entries()) {
    const withoutPunctuation = sentence.replace(/[.!?]+$/, "").trim();
    if (!/(니다|십시오|습니까)$/.test(withoutPunctuation)) {
      errors.push(`Sentence ${offset + 1} does not end in formal -니다, -십시오 or -습니까 style.`);
    }
  }

  if (["hook", "secret"].includes(section.kind)) {
    const firstSentence = sentences[0] ?? "";
    if (!SHOCK_OPENINGS.some((opening) => firstSentence.includes(opening))) {
      errors.push(`Section ${section.index} must open with an approved shock warning.`);
    }
  }
  if (!hasConsequence(text)) errors.push("The section lacks an explicit heavy consequence for ignoring the advice.");
  if (section.kind === "secret" && !hasConcreteKoreanNumber(text)) {
    errors.push("A secret section must include a concrete ritual number written in Korean.");
  }

  return errors.length > 0
    ? { ok: false, value: null, errors }
    : { ok: true, value: text, errors: [] };
}
