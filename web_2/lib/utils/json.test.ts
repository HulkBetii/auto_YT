import { describe, expect, it } from "vitest";

import { extractJson } from "./json";

describe("extractJson", () => {
  it("repairs literal control characters inside JSON strings", () => {
    const value = extractJson<Array<{ hook: string }>>(
      '[{"hook":"First line\nSecond\tline"}]',
    );

    expect(value).toEqual([{ hook: "First line\nSecond\tline" }]);
  });

  it("ignores structural characters inside strings", () => {
    const value = extractJson<Array<{ hook: string }>>(
      'prefix [{"hook":"Why [this] works } today"}] suffix',
    );

    expect(value).toEqual([{ hook: "Why [this] works } today" }]);
  });

  it("parses fenced JSON", () => {
    expect(extractJson("```json\n{\"ok\":true}\n```")).toEqual({ ok: true });
  });
});
