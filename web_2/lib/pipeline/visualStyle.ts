export const DOODLE_STYLE_PREFIX =
  "Hand-drawn 2D doodle cartoon animation, flat solid colors, bold black hand-drawn outlines, slightly wobbly imperfect marker lines,";

export const MAIN_CHARACTER_IDENTITY_LOCK =
  "Recurring main character identity lock: when the modern viewer, you, or the same recurring modern viewer mascot appears, depict the same gender-neutral modern viewer mascot every time: round white head, simple dot eyes, tiny nose, no makeup, no eyelashes, no beard, spiky bright orange hair, slim simple body, plain teal short-sleeve shirt, dark gray pants, white shoes; do not change gender, age, outfit, hairstyle, face shape, head color, body type, makeup, beard, or eyelashes.";

export const DOODLE_STYLE_LOCK =
  "no visible text, no captions, no labels, no numbers, no timestamp overlays, no written words, no hashtags, no hex color codes, no gradients, no drop shadows, no photographic textures, no photorealism, no 3D render, no realistic faces, no anime, wide horizontal composition, simple educational YouTube explainer doodle style.";

const LEGACY_DOODLE_STYLE_LOCK =
  "no gradients, no drop shadows, no photographic textures, no photorealism, no 3D render, no realistic faces, no anime, wide horizontal composition, simple educational YouTube explainer doodle style.";

const MAIN_CHARACTER_IDENTITY_RE =
  /Recurring main character identity lock:.*?(?:eyelashes\.|$)/giu;
const LOOSE_MODERN_VIEWER_IDENTITY_RE =
  /\b(?:a |the |same )?(?:gender-neutral )?(?:modern viewer|you|recurring modern viewer mascot|orange-haired modern viewer|modern orange-haired viewer)[^.\n]*(?:round white head|round white-headed|spiky bright orange hair|plain teal short-sleeve shirt|dark gray pants|white shoes)[^.\n]*(?:\.|$)/giu;

const TIMESTAMP_TOKEN_RE = /\[\d{1,2}:\d{2}(?::\d{2})?\]/g;
const HASH_TOKEN_RE = /#[\p{L}\p{N}_-]+/gu;
const QUOTED_TEXT_RE =
  /\b(?:bold\s+)?(?:red|black|white|blue|orange|green|yellow|cream|gray|grey)?\s*(?:hand[- ]lettered\s+)?text\s+[“"][^”"]+[”"]/giu;
const LABEL_TEXT_RE = /\b(?:label(?:ed|led)?|caption(?:ed)?)\s+[“"][^”"]+[”"]/giu;

export function sanitizeDoodlePromptDescription(text: string): string {
  return text
    .replaceAll(DOODLE_STYLE_PREFIX, "")
    .replaceAll(DOODLE_STYLE_LOCK, "")
    .replaceAll(LEGACY_DOODLE_STYLE_LOCK, "")
    .replace(MAIN_CHARACTER_IDENTITY_RE, "")
    .replace(LOOSE_MODERN_VIEWER_IDENTITY_RE, "the same recurring modern viewer mascot, ")
    .replace(TIMESTAMP_TOKEN_RE, "")
    .replace(HASH_TOKEN_RE, "")
    .replace(QUOTED_TEXT_RE, "simple symbolic doodle concept")
    .replace(LABEL_TEXT_RE, "marked with a simple icon")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[,.;:\s]+/, "")
    .replace(/[.,]?\s*$/, "")
    .trim();
}

export function wrapDoodleStyle(description: string): string {
  const cleanDescription = sanitizeDoodlePromptDescription(description);
  return `${DOODLE_STYLE_PREFIX} ${MAIN_CHARACTER_IDENTITY_LOCK} ${cleanDescription}, ${DOODLE_STYLE_LOCK}`;
}

export function formatImagePrompts(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map(wrapDoodleStyle)
    .join("\n");
}

export function formatThumbnailConcept(concept: string): string {
  return wrapDoodleStyle(concept);
}

