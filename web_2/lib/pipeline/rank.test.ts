import { describe, expect, it, vi } from "vitest";

import { parseS1Selection, selectS1Topic, type AhTopic } from "./rank";

function topic(title: string): AhTopic {
  return {
    title,
    head_keyword: title.toLowerCase(),
    angle: `${title} angle`,
    hook: `${title} hook`,
    viral_type: "what_how",
    key_questions: ["One?", "Two?", "Three?"],
  };
}

describe("parseS1Selection", () => {
  it("parses the Playwright S1 object format", () => {
    const parsed = parseS1Selection(JSON.stringify({
      candidates: [topic("First"), topic("Second")],
      recommended_index: 2,
    }));

    expect(parsed.recommendedIndex).toBe(2);
    expect(selectS1Topic(parsed).title).toBe("Second");
  });

  it("keeps legacy S1 arrays compatible", () => {
    const parsed = parseS1Selection(JSON.stringify([topic("Legacy"), topic("Other")]));

    expect(parsed.recommendedIndex).toBe(1);
    expect(selectS1Topic(parsed).title).toBe("Legacy");
  });

  it("falls back to the first candidate for an invalid index", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const parsed = parseS1Selection(JSON.stringify({
      candidates: [topic("First"), topic("Second")],
      recommended_index: 9,
    }));

    expect(selectS1Topic(parsed).title).toBe("First");
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("rejects candidates missing required fields", () => {
    expect(() => parseS1Selection(JSON.stringify({
      candidates: [{ ...topic("Broken"), title: "" }],
      recommended_index: 1,
    }))).toThrow("Candidate is missing required fields");
  });
});
