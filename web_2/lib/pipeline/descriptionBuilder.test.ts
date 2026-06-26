import { describe, expect, it } from "vitest";

import {
  buildDescription,
  computeChapterTimestamps,
  fmtChapterTime,
  parseS4Variable,
  parseWhisperSegments,
  type S4Variable,
} from "./descriptionBuilder";
import { channelConfig } from "@/lib/config/channel";

const baseVariable: S4Variable = {
  title: "Why Your Brain Still Fears Snakes",
  hook_paragraph: "Why your brain still fears snakes traces back to ancient survival pressure.",
  discover_bullets: ["Daily-life angle.", "Evidence angle.", "Modern-mirror angle."],
  chapter_titles: ["The Freeze", "The Reframe", "The Evidence", "A Day Reconstructed", "What It Means Today"],
  tags: "ancient humans, human evolution, prehistoric life",
  thumbnail: { concept: "Doodle concept.", text: "LOOK NOW", emotion: "shock", accent_color: "red" },
};

describe("computeChapterTimestamps", () => {
  it("returns [0] for an empty transcript", () => {
    expect(computeChapterTimestamps([], 6)).toEqual([0]);
  });

  it("always starts at 0", () => {
    const segments = Array.from({ length: 50 }, (_, i) => ({ start: i * 10 }));
    expect(computeChapterTimestamps(segments, 6)[0]).toBe(0);
  });

  it("produces a strictly monotonically increasing sequence", () => {
    const segments = Array.from({ length: 80 }, (_, i) => ({ start: i * 8 }));
    const out = computeChapterTimestamps(segments, 6);
    for (let i = 0; i + 1 < out.length; i++) {
      expect(out[i + 1]).toBeGreaterThan(out[i]);
    }
  });

  it("keeps every chapter at least 10s apart", () => {
    const segments = Array.from({ length: 80 }, (_, i) => ({ start: i * 8 }));
    const out = computeChapterTimestamps(segments, 6);
    for (let i = 0; i + 1 < out.length; i++) {
      expect(out[i + 1] - out[i]).toBeGreaterThanOrEqual(10);
    }
  });

  it("only returns timestamps that are real segment starts", () => {
    const segments = Array.from({ length: 80 }, (_, i) => ({ start: i * 8 }));
    const starts = new Set(segments.map((s) => s.start));
    const out = computeChapterTimestamps(segments, 6);
    for (const t of out) expect(starts.has(t)).toBe(true);
  });
});

describe("fmtChapterTime", () => {
  it("formats seconds under an hour as M:SS", () => {
    expect(fmtChapterTime(0)).toBe("0:00");
    expect(fmtChapterTime(90)).toBe("1:30");
    expect(fmtChapterTime(630)).toBe("10:30");
  });

  it("formats seconds over an hour as H:MM:SS", () => {
    expect(fmtChapterTime(3725)).toBe("1:02:05");
  });
});

describe("buildDescription", () => {
  const chapterTimes = computeChapterTimestamps(
    Array.from({ length: 80 }, (_, i) => ({ start: i * 8 })),
    baseVariable.chapter_titles.length,
  );

  it("ends with exactly 3 hashtags", () => {
    const out = buildDescription(baseVariable, chapterTimes);
    const lastLine = out.trim().split("\n").pop()!;
    const tags = lastLine.split(/\s+/).filter((t) => t.startsWith("#"));
    expect(tags).toHaveLength(3);
  });

  it("includes the subscribe URL and upload schedule verbatim", () => {
    const out = buildDescription(baseVariable, chapterTimes);
    expect(out).toContain(`${channelConfig.channelUrl}${channelConfig.subConfirmSuffix}`);
    expect(out).toContain(channelConfig.uploadSchedule);
  });

  it("omits MORE LIKE THIS when there are no related videos and no playlist", () => {
    const out = buildDescription(baseVariable, chapterTimes, { ...channelConfig, playlistUrl: "" }, []);
    expect(out).not.toContain("MORE LIKE THIS");
  });

  it("includes MORE LIKE THIS when a playlist URL is configured", () => {
    const out = buildDescription(baseVariable, chapterTimes, { ...channelConfig, playlistUrl: "https://x/playlist" });
    expect(out).toContain("MORE LIKE THIS");
  });

  it("omits the FTC disclosure when affiliate is disabled, includes it when enabled", () => {
    const off = buildDescription(baseVariable, chapterTimes, { ...channelConfig, affiliateEnabled: false });
    const on = buildDescription(baseVariable, chapterTimes, { ...channelConfig, affiliateEnabled: true });
    expect(off).not.toContain(channelConfig.affiliateDisclosure);
    expect(on).toContain(channelConfig.affiliateDisclosure);
  });

  it("pairs chapter lines to min(chapter_titles, chapterTimes) starting at 0:00", () => {
    const shortTimes = [0, 20, 40];
    const out = buildDescription(baseVariable, shortTimes);
    const chapterLines = out.split("\n").filter((l) => /^\d+:\d{2}/.test(l));
    expect(chapterLines).toHaveLength(3);
    expect(chapterLines[0].startsWith("0:00")).toBe(true);
  });

  it("places the hook (with the keyword-bearing first sentence) within the first 2 lines", () => {
    const out = buildDescription(baseVariable, chapterTimes);
    const firstTwoLines = out.split("\n").slice(0, 2).join(" ");
    expect(firstTwoLines).toContain("Why your brain still fears snakes");
  });
});

describe("parseS4Variable", () => {
  it("accepts a valid JSON object without error", () => {
    expect(() => parseS4Variable(baseVariable)).not.toThrow();
  });

  it("throws a clear error (not a silent crash) when a required field is missing", () => {
    const incomplete = { ...baseVariable, title: undefined };
    expect(() => parseS4Variable(incomplete)).toThrow(/title/);
  });

  it("does not reject unknown extra fields", () => {
    const withExtra = { ...baseVariable, some_future_field: "value" };
    expect(() => parseS4Variable(withExtra)).not.toThrow();
  });
});

describe("end-to-end: S4 JSON + real transcript -> assembled description", () => {
  it("produces the 7 sections in order: hook, discover, chapters, (more-like-this), (ftc), subscribe, hashtags", () => {
    const transcript = Array.from({ length: 100 }, (_, i) => `[${String(Math.floor((i * 8) / 60)).padStart(2, "0")}:${String((i * 8) % 60).padStart(2, "0")}] Segment ${i} of the narration.`).join("\n");
    const segments = parseWhisperSegments(transcript);
    const chapterTimes = computeChapterTimestamps(segments, baseVariable.chapter_titles.length);
    const cfg = { ...channelConfig, playlistUrl: "https://x/playlist", affiliateEnabled: true };
    const out = buildDescription(baseVariable, chapterTimes, cfg, [{ title: "Related", url: "https://x/v" }]);

    const hookIdx = out.indexOf(baseVariable.hook_paragraph);
    const discoverIdx = out.indexOf("In this video, you'll discover:");
    const chaptersIdx = out.indexOf("CHAPTERS");
    const moreIdx = out.indexOf("MORE LIKE THIS");
    const ftcIdx = out.indexOf(cfg.affiliateDisclosure);
    const subscribeIdx = out.indexOf("Subscribe:");
    const hashtagIdx = out.indexOf(cfg.hashtags[0]);

    expect(hookIdx).toBeGreaterThanOrEqual(0);
    expect([hookIdx, discoverIdx, chaptersIdx, moreIdx, ftcIdx, subscribeIdx, hashtagIdx]).toEqual(
      [hookIdx, discoverIdx, chaptersIdx, moreIdx, ftcIdx, subscribeIdx, hashtagIdx].slice().sort((a, b) => a - b),
    );
  });
});
