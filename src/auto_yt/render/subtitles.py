#!/usr/bin/env python3
"""Whisper segments → ASS subtitle file for the 哲人の刻 render pipeline.

The character images already carry a black left panel (with the persona name +
birth year baked in). We overlay ONE dynamic layer: the narration as subtitles,
left-aligned inside that black panel, timed from Whisper segment timestamps.

Layout constants come from measuring the 10 real 美輪明宏 images (1920x1080):
the black panel is clear from x≈60→950, y≈200→820; the sample quote is ~2 lines
of ~13-14 JP chars each, centred vertically around y≈380. Font: Shippori Mincho
B1 Bold, white, no outline (pure black panel gives enough contrast).

Usable standalone for testing:
    python -m auto_yt.render.subtitles --demo out.ass
"""
from __future__ import annotations

import argparse
import difflib
import json
import math
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# ── Layout defaults (pixel space; ASS PlayRes is pinned to 1920x1080) ────────
# Calibrated to the reference sample: a 13-char line fills ~92% of the black
# panel (left edge x≈80, right edge ≈1070), block vertically centred at y≈515.
# Shippori Mincho B1's full-width advance renders at ~0.65em under libass, so a
# 13-char line at FONT_SIZE=116 measures ≈75px/char — matching the sample —
# while staying clear of the portrait (the panel is black out to x≈1113 on the
# narrowest of the 10 images).
FONT_NAME = "Shippori Mincho B1"
FONT_SIZE = 116
# Anchor: middle-left (\an4) at (POS_X, POS_Y). Text left edge sits at POS_X,
# vertically centred on POS_Y regardless of 1 vs 2 lines — matches the sample.
POS_X = 80
POS_Y = 515
MAX_CHARS_PER_LINE = 13   # measured on the sample quote
MAX_LINES_PER_CARD = 2    # sample never exceeds 2 lines

# Break a line early once it is at least this fraction full AND lands on a
# Japanese clause/sentence delimiter — avoids orphaning 、/。 at a line start.
_PUNCT_BREAK = "、。！？"
_PUNCT_BREAK_MIN_FILL = 0.6
# 禁則処理: characters that must never START a line (pulled back to the previous
# line even if it means a 1-char overflow).
_KINSOKU_NO_LINE_START = "、。，．・！？：；）」』】〕〉》”’ー…"
# Close a sub-0.3s gap between consecutive cards so the panel never flickers.
_GAP_FILL_SECONDS = 0.3
_MIN_TRAILING_LINE_FILL = 0.75
_MIN_SOURCE_LINE_FILL = 0.6
_MAX_TRAILING_REBALANCE_CHARS = 2
_SENTENCE_END = "。！？!?"
_PAUSE_TAG_RE = re.compile(r"<#[^>]+#>")
_ALIGNMENT_MIN_COVERAGE = 0.70


@dataclass
class Card:
    start: float
    end: float
    lines: list[str]


@dataclass
class TimedCharacter:
    char: str
    start: float
    end: float


def clean_tts_display_text(text: str) -> str:
    """Return the exact Japanese narration text without TTS-only pause tags."""
    without_tags = _PAUSE_TAG_RE.sub("", text or "")
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", without_tags)).strip()


def _normalise_alignment_text(text: str) -> tuple[str, list[int]]:
    normalised: list[str] = []
    source_indexes: list[int] = []
    for source_index, char in enumerate(text):
        for normalised_char in unicodedata.normalize("NFKC", char).lower():
            category = unicodedata.category(normalised_char)
            if category[0] in {"L", "N"}:
                normalised.append(normalised_char)
                source_indexes.append(source_index)
    return "".join(normalised), source_indexes


def _normalise_words(words: list[dict]) -> tuple[str, list[tuple[float, float]]]:
    normalised: list[str] = []
    timings: list[tuple[float, float]] = []
    for word in words:
        text = str(word.get("word") or word.get("text") or "")
        word_text, _ = _normalise_alignment_text(text)
        if not word_text:
            continue
        start = float(word.get("start", 0.0))
        end = max(float(word.get("end", start)), start + 0.01)
        duration = end - start
        for index, char in enumerate(word_text):
            char_start = start + duration * index / len(word_text)
            char_end = start + duration * (index + 1) / len(word_text)
            normalised.append(char)
            timings.append((char_start, char_end))
    return "".join(normalised), timings


def align_tts_text_to_words(
    tts_text: str,
    words: list[dict],
    *,
    minimum_coverage: float = _ALIGNMENT_MIN_COVERAGE,
) -> tuple[list[TimedCharacter], float]:
    display_text = clean_tts_display_text(tts_text)
    source_text, source_indexes = _normalise_alignment_text(display_text)
    recognised_text, recognised_timings = _normalise_words(words)
    if not display_text or not source_text:
        raise ValueError("TTS display text is empty")
    if not recognised_text or not recognised_timings:
        raise ValueError("Whisper returned no usable word timestamps")

    source_times: list[tuple[float, float] | None] = [None] * len(source_text)
    matcher = difflib.SequenceMatcher(
        None,
        source_text,
        recognised_text,
        autojunk=False,
    )
    matched = 0
    for source_start, recognised_start, size in matcher.get_matching_blocks():
        if size == 0:
            continue
        matched += size
        for offset in range(size):
            source_times[source_start + offset] = recognised_timings[recognised_start + offset]

    coverage = matched / len(source_text)
    if coverage < minimum_coverage:
        raise ValueError(
            f"Whisper alignment coverage {coverage:.1%} is below {minimum_coverage:.0%}"
        )

    mapped_indexes = [index for index, value in enumerate(source_times) if value is not None]
    for index, value in enumerate(source_times):
        if value is not None:
            continue
        previous = next((i for i in reversed(mapped_indexes) if i < index), None)
        following = next((i for i in mapped_indexes if i > index), None)
        if previous is not None and following is not None:
            previous_end = source_times[previous][1]  # type: ignore[index]
            following_start = source_times[following][0]  # type: ignore[index]
            fraction = (index - previous) / (following - previous)
            point = previous_end + max(following_start - previous_end, 0.0) * fraction
            source_times[index] = (point, point + 0.01)
        elif previous is not None:
            point = source_times[previous][1] + 0.01 * (index - previous)  # type: ignore[index]
            source_times[index] = (point, point + 0.01)
        elif following is not None:
            point = max(
                source_times[following][0] - 0.01 * (following - index), 0.0  # type: ignore[index]
            )
            source_times[index] = (point, point + 0.01)

    display_times: list[tuple[float, float] | None] = [None] * len(display_text)
    for normalised_index, display_index in enumerate(source_indexes):
        timing = source_times[normalised_index]
        if timing is None:
            continue
        current = display_times[display_index]
        display_times[display_index] = (
            timing[0] if current is None else min(current[0], timing[0]),
            timing[1] if current is None else max(current[1], timing[1]),
        )

    mapped_display = [index for index, value in enumerate(display_times) if value is not None]
    for index, value in enumerate(display_times):
        if value is not None:
            continue
        previous = next((i for i in reversed(mapped_display) if i < index), None)
        following = next((i for i in mapped_display if i > index), None)
        if previous is not None:
            point = display_times[previous][1]  # type: ignore[index]
        elif following is not None:
            point = display_times[following][0]  # type: ignore[index]
        else:
            point = 0.0
        display_times[index] = (point, point + 0.01)

    timed = [
        TimedCharacter(char=char, start=timing[0], end=timing[1])
        for char, timing in zip(display_text, display_times)
        if timing is not None
    ]
    return timed, coverage


def wrap_text(text: str, max_chars: int = MAX_CHARS_PER_LINE) -> list[str]:
    """Greedy CJK line-wrap. Prefers breaking right after 、。！？ once the line
    is reasonably full; otherwise hard-breaks at `max_chars`."""
    text = " ".join(text.split())  # collapse whitespace/newlines
    lines: list[str] = []
    cur = ""
    for ch in text:
        cur += ch
        if ch in _PUNCT_BREAK and len(cur) >= max_chars * _PUNCT_BREAK_MIN_FILL:
            lines.append(cur)
            cur = ""
        elif len(cur) >= max_chars:
            lines.append(cur)
            cur = ""
    if cur:
        lines.append(cur)
    lines = _apply_kinsoku(lines)
    return _rebalance_short_trailing_line(lines, max_chars)


def _apply_kinsoku(lines: list[str]) -> list[str]:
    """Pull any line-start-forbidden char (、。！? etc.) back onto the previous
    line so it never becomes the first glyph of a line (禁則処理)."""
    for i in range(1, len(lines)):
        while lines[i] and lines[i][0] in _KINSOKU_NO_LINE_START:
            lines[i - 1] += lines[i][0]
            lines[i] = lines[i][1:]
    return [ln for ln in lines if ln]


def _rebalance_short_trailing_line(
    lines: list[str],
    max_chars: int,
) -> list[str]:
    if len(lines) < 2:
        return lines

    source_line = lines[-2]
    trailing_line = lines[-1]
    minimum_length = math.ceil(max_chars * _MIN_SOURCE_LINE_FILL)
    if (
        not source_line
        or not trailing_line
        or len(trailing_line) >= minimum_length
        or source_line[-1] in _SENTENCE_END
    ):
        return lines

    last_sentence_end = max(source_line.rfind(char) for char in _SENTENCE_END)
    movable_chars = len(source_line) - last_sentence_end - 1
    balanced_length = (len(source_line) + len(trailing_line)) // 2
    move_count = min(
        max(balanced_length - len(trailing_line), 0),
        movable_chars,
        max(len(source_line) - 1, 0),
    )
    while move_count > 0:
        moved_text = source_line[-move_count:]
        if moved_text[0] not in _KINSOKU_NO_LINE_START:
            lines[-2] = source_line[:-move_count]
            lines[-1] = moved_text + trailing_line
            break
        move_count -= 1
    return lines


def _group_lines_into_cards(lines: list[str], max_lines: int = MAX_LINES_PER_CARD) -> list[list[str]]:
    return [lines[i:i + max_lines] for i in range(0, len(lines), max_lines)]


def _rebalance_short_trailing_card(
    line_groups: list[list[str]],
    max_chars: int,
) -> list[list[str]]:
    if len(line_groups) < 2 or len(line_groups[-1]) != 1:
        return line_groups

    source_line = line_groups[-2][-1]
    trailing_line = line_groups[-1][0]
    if not source_line or not trailing_line or source_line[-1] in _SENTENCE_END:
        return line_groups

    target_length = math.ceil(max_chars * _MIN_TRAILING_LINE_FILL)
    source_min_length = math.ceil(max_chars * _MIN_SOURCE_LINE_FILL)
    move_count = min(
        max(target_length - len(trailing_line), 0),
        _MAX_TRAILING_REBALANCE_CHARS,
        max(len(source_line) - source_min_length, 0),
    )
    while move_count > 0:
        moved_text = source_line[-move_count:]
        if moved_text[0] not in _KINSOKU_NO_LINE_START:
            line_groups[-2][-1] = source_line[:-move_count]
            line_groups[-1][0] = moved_text + trailing_line
            break
        move_count -= 1
    return line_groups


def build_cards_for_segment(
    start: float,
    end: float,
    text: str,
    *,
    max_chars: int = MAX_CHARS_PER_LINE,
    max_lines: int = MAX_LINES_PER_CARD,
) -> list[Card]:
    """Split one Whisper segment into ≤`max_lines`-line cards, distributing the
    segment's time span across cards proportionally to their character count."""
    text = " ".join((text or "").split())
    if not text:
        return []
    line_groups = _group_lines_into_cards(wrap_text(text, max_chars), max_lines)
    line_groups = _rebalance_short_trailing_card(line_groups, max_chars)
    total_chars = sum(len("".join(g)) for g in line_groups) or 1
    span = max(end - start, 0.1)

    cards: list[Card] = []
    t = start
    for group in line_groups:
        gchars = len("".join(group)) or 1
        dur = span * gchars / total_chars
        cards.append(Card(start=t, end=t + dur, lines=group))
        t += dur
    return cards


def build_cards(segments: list[dict]) -> list[Card]:
    """Flatten Whisper segments (dicts with start/end/text) into timed cards,
    then close tiny inter-card gaps so the subtitle layer never flickers."""
    cards: list[Card] = []
    for seg in segments:
        cards.extend(
            build_cards_for_segment(
                float(seg.get("start", 0.0)),
                float(seg.get("end", seg.get("start", 0.0))),
                str(seg.get("text", "")),
            )
        )
    cards = [c for c in cards if c.lines and c.end > c.start]
    for i in range(len(cards) - 1):
        if 0 <= cards[i + 1].start - cards[i].end < _GAP_FILL_SECONDS:
            cards[i].end = cards[i + 1].start
    return cards


def build_aligned_cards(
    tts_text: str,
    words: list[dict],
    *,
    max_chars: int = MAX_CHARS_PER_LINE,
    max_lines: int = MAX_LINES_PER_CARD,
) -> tuple[list[Card], float]:
    timed_characters, coverage = align_tts_text_to_words(tts_text, words)
    display_text = "".join(item.char for item in timed_characters)
    line_groups = _group_lines_into_cards(
        wrap_text(display_text, max_chars),
        max_lines,
    )
    line_groups = _rebalance_short_trailing_card(line_groups, max_chars)

    cards: list[Card] = []
    offset = 0
    for group in line_groups:
        character_count = len("".join(group))
        group_characters = timed_characters[offset:offset + character_count]
        offset += character_count
        if not group_characters:
            continue
        start = group_characters[0].start
        end = max(group_characters[-1].end, start + 0.1)
        cards.append(Card(start=start, end=end, lines=group))

    if offset != len(timed_characters) or not cards:
        raise ValueError("Aligned subtitle cards did not preserve the complete TTS text")
    for index in range(len(cards) - 1):
        gap = cards[index + 1].start - cards[index].end
        if 0 <= gap < _GAP_FILL_SECONDS:
            cards[index].end = cards[index + 1].start
    return cards, coverage


def _fmt_ts(seconds: float) -> str:
    """ASS timestamp: H:MM:SS.cc (centiseconds)."""
    if seconds < 0:
        seconds = 0.0
    cs = int(round(seconds * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _escape(text: str) -> str:
    # ASS control chars — strip braces (override blocks) and normalise newlines.
    return text.replace("{", "(").replace("}", ")").replace("\n", " ")


def build_ass(
    segments: list[dict],
    *,
    font_name: str = FONT_NAME,
    font_size: int = FONT_SIZE,
    pos_x: int = POS_X,
    pos_y: int = POS_Y,
) -> str:
    """Render Whisper segments into a full ASS subtitle document (1920x1080)."""
    return _build_ass_document(
        build_cards(segments),
        font_name=font_name,
        font_size=font_size,
        pos_x=pos_x,
        pos_y=pos_y,
    )


def build_ass_from_alignment(
    tts_text: str,
    words: list[dict],
    *,
    font_name: str = FONT_NAME,
    font_size: int = FONT_SIZE,
    pos_x: int = POS_X,
    pos_y: int = POS_Y,
) -> tuple[str, float]:
    cards, coverage = build_aligned_cards(tts_text, words)
    return (
        _build_ass_document(
            cards,
            font_name=font_name,
            font_size=font_size,
            pos_x=pos_x,
            pos_y=pos_y,
        ),
        coverage,
    )


def _build_ass_document(
    cards: list[Card],
    *,
    font_name: str,
    font_size: int,
    pos_x: int,
    pos_y: int,
) -> str:
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Quote,{font_name},{font_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,4,{pos_x},0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    lines: list[str] = [header]
    override = f"{{\\an4\\pos({pos_x},{pos_y})}}"
    for card in cards:
        text = override + "\\N".join(_escape(ln) for ln in card.lines)
        lines.append(
            f"Dialogue: 0,{_fmt_ts(card.start)},{_fmt_ts(card.end)},Quote,,0,0,0,,{text}"
        )
    return "\n".join(lines) + "\n"


def write_ass(segments: list[dict], out_path: Path, **kwargs) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(build_ass(segments, **kwargs), encoding="utf-8")
    return out_path


def write_aligned_ass(
    tts_text: str,
    words: list[dict],
    out_path: Path,
    **kwargs,
) -> tuple[Path, float]:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    document, coverage = build_ass_from_alignment(tts_text, words, **kwargs)
    if "Dialogue:" not in document:
        raise ValueError("Aligned ASS document contains no subtitle events")
    out_path.write_text(document, encoding="utf-8")
    return out_path, coverage


_DEMO_SEGMENTS = [
    {"start": 0.0, "end": 4.0, "text": "確かにそうなんですけれど、実は黄色には問題があるの。"},
    {"start": 4.0, "end": 6.5, "text": "人は誰しも、心の奥に小さな灯りを持っています。"},
    {"start": 6.5, "end": 13.0, "text": "その灯りが消えそうになるとき、わたくしはいつも、"
        "若い頃に教わったひとつの言葉を思い出すのです。それは決して華やかではありませんでした。"},
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Whisper segments → ASS subtitles")
    parser.add_argument("out", help="Output .ass path")
    parser.add_argument("--segments", default="", help="JSON file: list of {start,end,text}")
    parser.add_argument("--demo", action="store_true", help="Use built-in demo segments")
    args = parser.parse_args()

    if args.demo or not args.segments:
        segments = _DEMO_SEGMENTS
    else:
        segments = json.loads(Path(args.segments).read_text(encoding="utf-8"))

    out = write_ass(segments, Path(args.out))
    cards = build_cards(segments)
    print(f"[subtitles] {len(segments)} segments → {len(cards)} cards → {out}")
    for c in cards:
        print(f"  {_fmt_ts(c.start)}–{_fmt_ts(c.end)}  {' / '.join(c.lines)}")


if __name__ == "__main__":
    main()
