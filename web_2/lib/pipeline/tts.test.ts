import { describe, expect, it } from "vitest";

import { smartBucketTranscript } from "./tts";

const MIN_DURATION = 4;
const MAX_DURATION = 12;

function line(mm: number, ss: number, text: string): string {
  return `[${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}] ${text}`;
}

function parseOutput(output: string): { t: number; text: string }[] {
  return output.split("\n").filter((l) => l.trim()).map((l) => {
    const m = l.match(/^\[(\d{2}):(\d{2})\]\s*(.*)/);
    if (!m) throw new Error(`Output line does not match [MM:SS] text format: ${l}`);
    return { t: parseInt(m[1]) * 60 + parseInt(m[2]), text: m[3] };
  });
}

describe("smartBucketTranscript", () => {
  it("returns empty transcript unchanged", () => {
    expect(smartBucketTranscript("")).toBe("");
  });

  it("keeps a single segment as a single bucket", () => {
    const input = line(0, 0, "Hello world.");
    const output = smartBucketTranscript(input);
    const buckets = parseOutput(output);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toEqual({ t: 0, text: "Hello world." });
  });

  it("merges a short trailing segment back into the previous bucket", () => {
    // Segments at 0s, 5s (each >= MIN on its own via gap), then a very short
    // tail at 9s with no next segment (estimated duration ~2s, well under MIN).
    const input = [
      line(0, 0, "First long enough chunk that ends here."),
      line(0, 5, "Second chunk also long enough."),
      line(0, 9, "Tiny tail."),
    ].join("\n");
    const buckets = parseOutput(smartBucketTranscript(input));
    // Tail must not survive as its own sub-MIN trailing bucket; it gets
    // folded into the bucket that precedes it instead of staying separate.
    expect(buckets).toHaveLength(2);
    const last = buckets[buckets.length - 1];
    expect(last.text).toContain("Second chunk");
    expect(last.text).toContain("Tiny tail.");
  });

  it("never produces a bucket longer than MAX_DURATION (look-ahead cap)", () => {
    // Eight consecutive 8s segments with no sentence-ending punctuation —
    // would overshoot MAX_DURATION if checked after adding instead of before.
    const lines: string[] = [];
    for (let i = 0; i < 8; i++) {
      const t = i * 8;
      lines.push(line(Math.floor(t / 60), t % 60, `chunk number ${i} continues without stopping`));
    }
    const buckets = parseOutput(smartBucketTranscript(lines.join("\n")));
    for (let i = 0; i + 1 < buckets.length; i++) {
      const dur = buckets[i + 1].t - buckets[i].t;
      expect(dur).toBeLessThanOrEqual(MAX_DURATION);
    }
  });

  it("merges a staccato run of 1s sentences instead of leaving sub-MIN buckets", () => {
    const phrases = ["Then memory.", "Then culture.", "Then stories.", "Then myths.", "Then gods."];
    const lines = phrases.map((text, i) => line(0, i, text));
    const buckets = parseOutput(smartBucketTranscript(lines.join("\n")));
    expect(buckets.length).toBeLessThan(phrases.length);
    for (let i = 0; i + 1 < buckets.length; i++) {
      const dur = buckets[i + 1].t - buckets[i].t;
      expect(dur).toBeGreaterThanOrEqual(MIN_DURATION);
    }
  });

  it("preserves 1:1 mapping when every segment is already long enough", () => {
    // Each gap is >= MIN_DURATION, and the trailing segment's text is long
    // enough that its CHARS_PER_SEC estimate also clears MIN_DURATION, so no
    // bucket needs merging anywhere, including the tail.
    const lines = [
      line(0, 0, "First scene already long enough on its own."),
      line(0, 6, "Second scene also already long enough."),
      line(0, 13, "Third and final scene, with text long enough that its estimated duration also clears the minimum on its own."),
    ];
    const buckets = parseOutput(smartBucketTranscript(lines.join("\n")));
    expect(buckets).toHaveLength(lines.length);
  });

  it("estimates trailing segment duration from text length without crashing", () => {
    const input = [
      line(0, 0, "First long enough chunk that ends here."),
      line(0, 5, "A reasonably long final sentence that has no following segment to measure against."),
    ].join("\n");
    expect(() => smartBucketTranscript(input)).not.toThrow();
    const buckets = parseOutput(smartBucketTranscript(input));
    expect(buckets.every((b) => Number.isFinite(b.t))).toBe(true);
  });

  it("handles plain [MM:SS] text input with no extra fields (backward-compat)", () => {
    const input = line(1, 23, "Just a normal line.");
    expect(() => smartBucketTranscript(input)).not.toThrow();
  });

  it("produces monotonically increasing, correctly formatted timestamps with single-space joins", () => {
    const lines = ["Then memory.", "Then culture.", "Then stories."].map((text, i) => line(0, i, text));
    const output = smartBucketTranscript(lines.join("\n"));
    const buckets = parseOutput(output);
    expect(output).toMatch(/^\[\d{2}:\d{2}\] /m);
    for (let i = 0; i + 1 < buckets.length; i++) {
      expect(buckets[i + 1].t).toBeGreaterThan(buckets[i].t);
    }
    const merged = buckets.find((b) => b.text.includes("Then memory."));
    expect(merged?.text).not.toMatch(/\s{2,}/);
  });
});
