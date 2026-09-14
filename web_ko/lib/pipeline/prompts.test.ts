import { describe, expect, it } from "vitest";

import {
  DEFAULT_FIDELITY_REVIEW_PROMPT,
  DEFAULT_OUTLINE_PROMPT,
  DEFAULT_SECTION_PROMPT,
  DEFAULT_SOURCE_AUDIT_PROMPT,
  SECTION_EFFORT,
} from "@/lib/pipeline/default-prompts";
import {
  buildFidelityReviewPrompt,
  buildOutlinePrompt,
  buildSectionPrompt,
  buildSourceAuditPrompt,
} from "@/lib/pipeline/prompts";

const facts = [
  {
    id: "F001",
    category: "direction" as const,
    disposition: "preserve" as const,
    meaning_ko: "남서쪽 창고는 계약운을 높입니다.",
    source_segments: [10],
  },
];

describe("manual Korean workflow prompts", () => {
  it("uses High for both outline and section jobs", () => {
    expect(SECTION_EFFORT).toBe("High");
  });

  it("asks for a numbered outline instead of JSON", () => {
    const prompt = buildOutlinePrompt(DEFAULT_OUTLINE_PROMPT, "한국어 원본 제목", facts);
    expect(prompt).toContain("1. Tên phần");
    expect(prompt).toContain("한국어 원본 제목");
    expect(prompt).toContain("Không JSON");
    expect(prompt).toContain("F001 | direction | preserve");
    expect(prompt).not.toContain("OUTLINE_SCHEMA");
  });

  it("sends only the current outline section when drafting prose", () => {
    const prompt = buildSectionPrompt({
      template: DEFAULT_SECTION_PROMPT,
      section: {
        outlineData: {
          index: 2,
          kind: "secret",
          internal_name: "첫 번째 비밀",
          points: ["천일염 세 줌을 놓으십시오"],
          raw_text: "2. 첫 번째 비밀\n- 천일염 세 줌을 놓으십시오",
        },
      } as never,
      sourceFacts: facts,
    });
    expect(prompt).toContain("2. 첫 번째 비밀");
    expect(prompt).not.toContain("FULL_OUTLINE_JSON");
    expect(prompt).not.toContain("PREVIOUS_TAIL");
    expect(prompt).toContain("남서쪽 창고");
  });

  it("builds strict source and final audit prompts", () => {
    expect(buildSourceAuditPrompt(DEFAULT_SOURCE_AUDIT_PROMPT, "소금 제목")).toContain(
      "keep_end_segment",
    );
    const prompt = buildFidelityReviewPrompt({
      template: DEFAULT_FIDELITY_REVIEW_PROMPT,
      sourceTitle: "소금 제목",
      sourceFacts: facts,
      outline: { raw_text: "1. 개요", sections: [] },
      finalScript: "완성 대본입니다.",
    });
    expect(prompt).toContain("남서쪽 창고");
    expect(prompt).toContain("완성 대본입니다");
    expect(prompt).toContain('"verdict": "pass"');
  });
});
