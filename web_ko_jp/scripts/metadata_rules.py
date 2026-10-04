"""
metadata_rules.py
=================
Pure text helpers shared by the title validator, the pre-publish gate and the Turn 3 parser.

Japanese has no word boundaries, so similarity and coverage use character bigrams instead of
word tokens (recap_comics compares English words).
"""
import re
import unicodedata
from typing import List, Set

BLOCK_LINE_RE = re.compile(r"BLOCK\s*\d", re.IGNORECASE)
PLACEHOLDER_TIMESTAMP_RE = re.compile(r"XX:XX")
# Latin letters that only Vietnamese uses; Japanese descriptions never contain them, so any hit
# means a Vietnamese prompt hint leaked into the copy-paste text.
VIETNAMESE_CHAR_RE = re.compile(
    r"[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]",
    re.IGNORECASE,
)
HASHTAG_RE = re.compile(r"(?:^|\s)(#[^\s#]+)")
LEADING_BRACKET_RE = re.compile(r"^\s*【[^】]*】\s*")
ORDINAL_RE = re.compile(r"([一二三四五六七八九十]+|\d+)\s*(?:つ目|個目|番目)")
# A number counts as a title "promise" only when attached to a counter: 5選, 8種類, 7つの, 10の鉄則.
COUNTED_NUMBER_RE = re.compile(r"([一二三四五六七八九十]+|\d+)\s*(?:選|種類|つ|人|個|か条|ヶ条|カ条|箇条|の)")
CIRCLED_DIGITS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
KANJI_DIGITS = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def normalize(text: str) -> str:
    """NFKC (full-width digits/letters to half-width) and drop whitespace."""
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text or ""))


def kanji_to_int(token: str) -> int:
    """Parses 1-99 written as digits or simple kanji (八, 十, 十二, 二十)."""
    if token.isdigit():
        return int(token)
    if "十" not in token:
        return KANJI_DIGITS.get(token, 0)
    tens_part, _, ones_part = token.partition("十")
    tens = KANJI_DIGITS.get(tens_part, 0) if tens_part else 1
    ones = KANJI_DIGITS.get(ones_part, 0) if ones_part else 0
    return tens * 10 + ones


def has_vietnamese(text: str) -> bool:
    return bool(VIETNAMESE_CHAR_RE.search(text or ""))


def clean_description(text: str) -> str:
    """Drops prompt scaffolding (BLOCK headers, Vietnamese hint lines) from a description."""
    kept = [
        line for line in (text or "").splitlines()
        if not BLOCK_LINE_RE.search(line) and not has_vietnamese(line)
    ]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


def count_hashtags(text: str) -> int:
    return len(HASHTAG_RE.findall(text or ""))


def strip_leading_bracket(title: str) -> str:
    return LEADING_BRACKET_RE.sub("", title or "")


def char_bigrams(text: str) -> Set[str]:
    chars = [c for c in normalize(text) if c.isalnum()]
    return {a + b for a, b in zip(chars, chars[1:])}


def char_bigram_jaccard(a: str, b: str) -> float:
    ba, bb = char_bigrams(a), char_bigrams(b)
    if not ba or not bb:
        return 0.0
    return len(ba & bb) / len(ba | bb)


def bigram_coverage(needle: str, haystack: str) -> float:
    """Share of the needle's bigrams that also occur in the haystack."""
    bn = char_bigrams(needle)
    if not bn:
        return 0.0
    return len(bn & char_bigrams(haystack)) / len(bn)


def counted_numbers(text: str) -> Set[int]:
    """Numbers a title/thumbnail promises (8種類, 5選, 七つの…). One is ignored: 一人で / 一つの are prose."""
    return {n for n in (kanji_to_int(m) for m in COUNTED_NUMBER_RE.findall(normalize(text))) if n > 1}


def count_script_items(script: str) -> int:
    """Highest ordinal (一つ目, 2つ目, 八番目…) in a script whose items start at one; 0 if unnumbered."""
    ordinals = {kanji_to_int(m) for m in ORDINAL_RE.findall(normalize(script))}
    if 1 not in ordinals:
        return 0
    return max(ordinals)


def count_circled_chapters(chapter_lines: List[str]) -> int:
    """Chapters numbered with ①②③…, the format Turn 3 uses for list items."""
    return sum(1 for line in chapter_lines if any(d in line for d in CIRCLED_DIGITS))


def longest_common_substring(a: str, b: str) -> str:
    a, b = normalize(a), normalize(b)
    best = ""
    for i in range(len(a)):
        for j in range(i + len(best) + 1, len(a) + 1):
            if a[i:j] in b:
                best = a[i:j]
            else:
                break
    return best
