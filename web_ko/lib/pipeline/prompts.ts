import type { KoSection } from "@/lib/db/schema";
import type {
  KoOutline,
  KoOutlineSection,
  SourceFact,
} from "@/lib/pipeline/validators";

export function interpolatePrompt(template: string, values: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  const unresolved = result.match(/{{[A-Z0-9_]+}}/g);
  if (unresolved) throw new Error(`Unresolved prompt placeholders: ${unresolved.join(", ")}`);
  return result;
}

export function formatSourceFacts(sourceFacts: SourceFact[], factIds?: string[]): string {
  const selected = factIds
    ? sourceFacts.filter((fact) => factIds.includes(fact.id))
    : sourceFacts;
  return selected
    .map(
      (fact) =>
        `${fact.id} | ${fact.category} | ${fact.disposition} | ${fact.meaning_ko} | segments ${fact.source_segments.join(",")}`,
    )
    .join("\n");
}

export function buildSourceAuditPrompt(template: string, sourceTitle: string): string {
  return interpolatePrompt(template, {
    SOURCE_TITLE: sourceTitle,
  });
}

export function buildOutlinePrompt(
  template: string,
  sourceTitle: string,
  sourceFacts: SourceFact[],
): string {
  return interpolatePrompt(template, {
    SOURCE_TITLE: sourceTitle,
    REQUIRED_FACTS: formatSourceFacts(sourceFacts),
  });
}

export function buildSectionPrompt(input: {
  template: string;
  section: KoSection;
  sourceFacts: SourceFact[];
}): string {
  const outlineData = input.section.outlineData as KoOutlineSection;
  return interpolatePrompt(input.template, {
    TARGET_SECTION_OUTLINE: outlineData.raw_text,
    REQUIRED_FACTS: formatSourceFacts(input.sourceFacts, outlineData.source_fact_ids),
  });
}

export function buildFidelityReviewPrompt(input: {
  template: string;
  sourceTitle: string;
  sourceFacts: SourceFact[];
  outline: KoOutline;
  finalScript: string;
}): string {
  return interpolatePrompt(input.template, {
    SOURCE_TITLE: input.sourceTitle,
    REQUIRED_FACTS: formatSourceFacts(input.sourceFacts),
    FULL_OUTLINE: input.outline.raw_text,
    FINAL_SCRIPT: input.finalScript,
  });
}

export function buildFidelitySectionRepairPrompt(input: {
  section: KoSection;
  currentBody: string;
  instructionsKo: string;
  requiredFacts: SourceFact[];
}): string {
  const outlineData = input.section.outlineData as KoOutlineSection;
  return `방금 완성한 전체 대본의 원문 충실도 검사가 이 부분만 수정을 요구했습니다.
같은 대화의 원본 자료와 문체를 유지하면서 아래 부분 전체를 다시 쓰십시오.

현재 부분의 개요:
${outlineData.raw_text}

반드시 보존할 원문 사실:
${formatSourceFacts(input.requiredFacts)}

검사 지시:
${input.instructionsKo}

현재 본문:
${input.currentBody}

기존 부분의 좋은 내용은 유지하고 누락되거나 모순된 사실만 자연스럽게 보완하십시오.
내부 fact ID는 본문에 쓰지 마십시오.
수정한 해당 부분의 순수 한국어 산문만 반환하십시오. 제목, 목록, 설명을 쓰지 마십시오.`;
}

export function buildRepairPrompt(input: {
  kind: "source_audit" | "outline" | "section" | "fidelity_review";
  errors: string[];
  invalidResult: string;
}): string {
  const outputRule =
    input.kind === "source_audit" || input.kind === "fidelity_review"
      ? "수정한 유효 JSON만 반환하십시오. 코드 펜스와 설명을 쓰지 마십시오."
      : input.kind === "outline"
      ? "수정한 한국어 번호식 다단계 개요만 반환하십시오. JSON과 설명을 쓰지 마십시오."
      : "수정한 해당 부분의 순수 산문만 반환하십시오. 제목과 설명을 쓰지 마십시오.";
  return `방금 결과가 자동 검증을 통과하지 못했습니다. 같은 대화의 원본 자료와 전체 맥락을 유지한 채 아래 오류만 정확히 고치십시오.\n\n검증 오류:\n${input.errors
    .map((error, index) => `${index + 1}. ${error}`)
    .join("\n")}\n\n수정할 원문:\n${input.invalidResult}\n\n${outputRule}`;
}
