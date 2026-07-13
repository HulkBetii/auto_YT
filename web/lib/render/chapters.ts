const CHAPTER_ANCHOR_SUFFIX_RE =
  /\s*[|｜]\s*ANCHOR\s*[:=：]\s*.+$/i;

export function stripChapterAnchor(line: string) {
  return line.replace(CHAPTER_ANCHOR_SUFFIX_RE, "").trim();
}
