import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const promptScripts = [
  "scripts/update-prompts.ts",
  "scripts/update-stickly-prompts.ts",
  "scripts/update-explain-in-paint-prompts.ts",
];

function readPromptScript(path: string): string {
  return readFileSync(path, "utf8");
}

describe("image DNA prompt copy", () => {
  it("keeps focal interaction, yellow text, and support-figure guidance in all prompt sets", () => {
    for (const path of promptScripts) {
      const source = readPromptScript(path);

      expect(source).toMatch(/dominant focal interaction|one dominant focal interaction/i);
      expect(source).toMatch(/bold yellow|yellow text|big yellow/i);
      expect(source).toMatch(/supporting figures|supporting animals|small supporting figures/i);
    }
  });

  it("keeps S3 clean while S4 carries thumbnail text DNA", () => {
    for (const path of promptScripts) {
      const source = readPromptScript(path);
      const s3Template = source.match(/const S3_TEMPLATE = `([\s\S]*?)`;/)?.[1] ?? "";
      const s4Template = source.match(/const S4_TEMPLATE = `([\s\S]*?)`;/)?.[1] ?? "";

      expect(s3Template).toContain("Do NOT include style prefix");
      expect(s3Template).toContain("Do not place text inside the image");
      expect(s3Template).toContain("Keep S3 text-free");
      expect(s3Template).not.toMatch(/Use in-image text sparingly/i);
      expect(s3Template).not.toMatch(/Only ask for text inside the image/i);
      expect(s3Template).not.toMatch(/text overlay when useful/i);
      expect(s4Template).toContain("thumbnail");
      expect(s4Template).toContain("bold yellow");
      expect(s4Template).toContain('"text"');
    }
  });
});
