import { describe, expect, it } from "vitest";

import {
  validateFidelityReview,
  validateOutline,
  validateSectionText,
  validateSourceAudit,
} from "@/lib/pipeline/validators";

const validOutline = `1. 오프닝 훅 — 당신의 아파트가 재물을 밀어내는 경고
- 같은 평수에서도 돈이 새는 집과 모이는 집의 차이를 경고하십시오.
- 오늘 당장 현관부터 확인하라고 명령하십시오.

2. 첫 번째 비밀 — 천일염으로 현관 기운을 바로잡는 법
- 천일염 세 줌을 한지 위에 놓는 구체적인 절차를 설명하십시오.
- 무시하면 카드값과 경조사비로 복이 빠져나간다고 경고하십시오.

3. 마지막 정리 — 조상 은덕을 받는 즉시 행동
- 음력 초하루에 정성을 다해 집을 정돈하라고 명령하십시오.
- 미루면 재물길이 다시 막힌다는 결과로 마무리하십시오.`;

describe("validateOutline", () => {
  it("parses the numbered Korean outline used by the manual workflow", () => {
    const result = validateOutline(validOutline);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections).toHaveLength(3);
    expect(result.value.sections[0]).toMatchObject({ index: 1, kind: "hook" });
    expect(result.value.sections[1]).toMatchObject({ index: 2, kind: "secret" });
    expect(result.value.sections[2]).toMatchObject({ index: 3, kind: "closing" });
    expect(result.value.sections[1].raw_text).toContain("천일염 세 줌");
  });

  it("rejects code fences, index gaps, and banned materials", () => {
    expect(validateOutline(`\`\`\`\n${validOutline}\n\`\`\``).ok).toBe(false);
    expect(validateOutline(validOutline.replace("2. 첫 번째", "4. 첫 번째")).ok).toBe(false);
    expect(validateOutline(validOutline.replace("천일염", "일본 금전수")).ok).toBe(false);
  });

  it("requires detailed bullets under every numbered section", () => {
    const invalid = validOutline.replace(
      "- 천일염 세 줌을 한지 위에 놓는 구체적인 절차를 설명하십시오.\n- 무시하면 카드값과 경조사비로 복이 빠져나간다고 경고하십시오.",
      "",
    );
    expect(validateOutline(invalid).ok).toBe(false);
  });

  it("removes ChatGPT source citation labels from parsed outline points", () => {
    const result = validateOutline(validOutline.replace("설명하십시오.", "설명하십시오. source"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.raw_text).not.toContain("source");
    expect(result.value.sections[0].raw_text).not.toContain("source");
  });

  it("requires every preserved source fact exactly once", () => {
    const facts = [
      {
        id: "F001",
        category: "direction" as const,
        disposition: "preserve" as const,
        meaning_ko: "남서쪽 창고를 사용하십시오.",
        source_segments: [10],
      },
      {
        id: "F002",
        category: "disposal" as const,
        disposition: "preserve" as const,
        meaning_ko: "묵은 소금은 물로 흘려보내십시오.",
        source_segments: [20],
      },
    ];
    const covered = validOutline
      .replace("구체적인 절차를 설명하십시오.", "구체적인 절차를 설명하십시오. [F001]")
      .replace("결과로 마무리하십시오.", "결과로 마무리하십시오. [F002]");
    expect(validateOutline(covered, facts).ok).toBe(true);
    const missing = validateOutline(covered.replace("[F002]", ""), facts);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors).toContain("Outline is missing required source fact F002.");
    const duplicated = validateOutline(covered.replace("[F001]", "[F001] [F002]"), facts);
    expect(duplicated.ok).toBe(false);
  });
});

describe("source and fidelity gates", () => {
  const segments = Array.from({ length: 30 }, (_, offset) => ({
    index: offset + 1,
    startMs: offset * 1000,
    endMs: offset * 1000 + 900,
    text: offset < 20 ? "소금과 재물운 이야기입니다." : "제사상 이야기입니다.",
  }));
  const audit = {
    primary_topic: "천일염과 재물운",
    keep_start_segment: 1,
    keep_end_segment: 20,
    boundary_confidence: "high",
    boundary_reason: "이후 제사상 주제로 전환됩니다.",
    excluded_topics: [
      { start_segment: 21, end_segment: 30, topic: "제사상", reason: "제목과 다른 주제입니다." },
    ],
    required_facts: [
      {
        id: "F001",
        category: "direction",
        disposition: "preserve",
        meaning_ko: "남서쪽 창고를 정리하십시오.",
        source_segments: [10],
      },
      {
        id: "F002",
        category: "disposal",
        disposition: "preserve",
        meaning_ko: "묵은 소금은 물로 흘려보내십시오.",
        source_segments: [20],
      },
    ],
  };

  it("accepts a confident contiguous cut and rejects ambiguous boundaries", () => {
    expect(validateSourceAudit(JSON.stringify(audit), segments).ok).toBe(true);
    const ambiguous = validateSourceAudit(
      JSON.stringify({ ...audit, boundary_confidence: "ambiguous" }),
      segments,
    );
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.errors).toContain("Source topic boundary is ambiguous.");
  });

  it("validates targeted fidelity repairs and rejects false passes", () => {
    const facts = audit.required_facts.map((fact) => ({
      ...fact,
      category: fact.category as "direction" | "disposal",
      disposition: fact.disposition as "preserve",
    }));
    const repair = {
      verdict: "repair",
      summary_ko: "두 가지 원문 사실이 빠졌습니다.",
      missing_fact_ids: ["F001", "F002"],
      contradictions: [],
      unrelated_topic_intrusions: [],
      repairs: [
        { section_index: 6, instructions_ko: "남서쪽 규칙을 넣으십시오.", required_fact_ids: ["F001"] },
        { section_index: 7, instructions_ko: "소금 처리법을 넣으십시오.", required_fact_ids: ["F002"] },
      ],
    };
    expect(validateFidelityReview(JSON.stringify(repair), facts, [6, 7]).ok).toBe(true);
    const falsePass = validateFidelityReview(
      JSON.stringify({ ...repair, verdict: "pass" }),
      facts,
      [6, 7],
    );
    expect(falsePass.ok).toBe(false);
  });
});

describe("validateSectionText", () => {
  const validText = [
    "부자들은 절대 말해주지 않습니다.",
    "당신이 이 경고를 무시하면 현관으로 들어온 복이 카드값과 생활비로 빠져나가 결국 재물길이 막힙니다.",
    "오늘 당장 천일염 세 줌을 한지 한 장 위에 올려 현관 안쪽에 놓으십시오.",
    "정성을 다하면 조상 은덕이 당신의 집 안에 오래 머뭅니다.",
  ].join(" ");

  it("accepts the longer spoken sentences shown in the manual workflow", () => {
    expect(
      validateSectionText(validText, {
        index: 2,
        kind: "secret",
      }),
    ).toEqual({ ok: true, value: validText, errors: [] });
  });

  it("rejects Arabic digits, caveats and markdown", () => {
    const invalid = `# 비밀 1\n${validText} 과학적 근거는 없지만 참고만 하십시오.`;
    const result = validateSectionText(invalid, {
      index: 2,
      kind: "secret",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/Arabic digits|Banned terms|Headings/);
  });

  it("does not enforce the old 15-25 Hangul-character interpretation", () => {
    const result = validateSectionText(validText, { index: 2, kind: "secret" });
    expect(result.ok).toBe(true);
    if (!result.ok) expect(result.errors.join(" ")).not.toContain("Hangul characters");
  });

  it("accepts formal rhetorical questions ending in -습니까", () => {
    const withQuestion = validText.replace(
      "부자들은 절대 말해주지 않습니다.",
      "부자들은 절대 말해주지 않습니다. 당신은 아직도 이 경고를 외면하고 있습니까.",
    );
    expect(validateSectionText(withQuestion, { index: 2, kind: "secret" }).ok).toBe(true);
  });
});
