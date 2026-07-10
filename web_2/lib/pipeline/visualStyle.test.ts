import { describe, expect, it } from "vitest";

import {
  DOODLE_STYLE_LOCK,
  DOODLE_STYLE_PREFIX,
  MAIN_CHARACTER_IDENTITY_LOCK,
  formatImagePrompts,
  formatThumbnailConcept,
  sanitizeDoodlePromptDescription,
} from "./visualStyle";

describe("visualStyle", () => {
  it("wraps bare S3 prompt lines with the house doodle style and identity lock", () => {
    const out = formatImagePrompts("[00:03] A worried brown-haired ancient human watches a wolf near a cave. #test");

    expect(out).toContain(DOODLE_STYLE_PREFIX);
    expect(out).toContain(MAIN_CHARACTER_IDENTITY_LOCK);
    expect(out).toContain(DOODLE_STYLE_LOCK);
    expect(out).toContain("worried brown-haired ancient human watches a wolf near a cave");
    expect(out).not.toContain("[00:03]");
    expect(out).not.toContain("#test");
  });

  it("does not duplicate style prefix, identity lock, or style lock", () => {
    const input = `${DOODLE_STYLE_PREFIX} ${MAIN_CHARACTER_IDENTITY_LOCK} A human holds a clay pot, ${DOODLE_STYLE_LOCK}`;
    const out = formatThumbnailConcept(input);

    expect(out.match(/Hand-drawn 2D doodle cartoon animation/g)).toHaveLength(1);
    expect(out.match(/Recurring main character identity lock/g)).toHaveLength(1);
    expect(out.match(/simple educational YouTube explainer doodle style/g)).toHaveLength(1);
  });

  it("normalizes loose modern viewer identity without duplicating the full mascot description", () => {
    const out = formatImagePrompts(
      "The same gender-neutral modern viewer mascot with round white head, spiky bright orange hair, plain teal short-sleeve shirt, dark gray pants, and white shoes looks scared.",
    );

    expect(out.match(/Recurring main character identity lock/g)).toHaveLength(1);
    expect(out).toContain("the same recurring modern viewer mascot");
    expect(out.match(/plain teal short-sleeve shirt/g)).toHaveLength(1);
  });

  it("replaces explicit long text and label requests with safer concepts", () => {
    const out = sanitizeDoodlePromptDescription(
      'bold red text "A VERY LONG CAPTION" above a bowl labeled "ANCIENT SOUP"',
    );

    expect(out).toContain("simple symbolic doodle concept");
    expect(out).toContain("marked with a simple icon");
    expect(out).not.toContain("A VERY LONG CAPTION");
    expect(out).not.toContain("ANCIENT SOUP");
  });

  it("wraps S4 thumbnail concepts with the same identity lock", () => {
    const out = formatThumbnailConcept("the same recurring modern viewer mascot recoils from a tiny harmless snake");

    expect(out).toContain(MAIN_CHARACTER_IDENTITY_LOCK);
    expect(out).toContain("tiny harmless snake");
  });
});
