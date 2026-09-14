import { describe, expect, it } from "vitest";

import { parseYouTubeUrl } from "@/lib/youtube";

describe("parseYouTubeUrl", () => {
  it("normalizes standard and short YouTube URLs", () => {
    expect(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      videoId: "dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(parseYouTubeUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ").videoId).toBe("dQw4w9WgXcQ");
  });

  it("rejects non-YouTube and malformed URLs", () => {
    expect(() => parseYouTubeUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toThrow();
    expect(() => parseYouTubeUrl("https://youtube.com/watch?v=bad")).toThrow();
  });
});
