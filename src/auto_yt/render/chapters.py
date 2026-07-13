"""Resolve P4 chapter titles against aligned subtitle cards."""
from __future__ import annotations

import difflib
import math
import re
import unicodedata
from dataclasses import dataclass

from auto_yt.render.subtitles import Card

MIN_CHAPTER_GAP_SECONDS = 10.0
LEGACY_LAST_CHAPTER_RATIO = 0.94
MIN_FUZZY_CONFIDENCE = 0.35
MAX_FUZZY_CANDIDATES = 12

_CHAPTER_LINE_RE = re.compile(r"^\s*(\d{1,2}):(\d{2})\s+(.+?)\s*$")
_ANCHOR_RE = re.compile(
    r"\s*[|｜]\s*ANCHOR\s*[:=：]\s*(.+?)\s*$",
    re.IGNORECASE,
)
_DESCRIPTION_CHAPTER_RE = re.compile(
    r"(⏱\s*チャプター\s*\r?\n[━─-]+\s*\r?\n)"
    r".*?"
    r"(\r?\n\r?\n[━─-]+\s*\r?\n🎬)",
    re.DOTALL,
)


@dataclass(frozen=True)
class ChapterSpec:
    estimated_seconds: float
    title: str
    anchor: str | None = None


@dataclass(frozen=True)
class ResolvedChapter:
    seconds: float
    title: str
    estimated_seconds: float
    anchor: str | None
    method: str
    confidence: float


@dataclass(frozen=True)
class _Candidate:
    seconds: float
    method: str
    confidence: float
    score: float


def _normalize_match_text(text: str) -> str:
    return "".join(
        char.lower()
        for char in unicodedata.normalize("NFKC", text or "")
        if unicodedata.category(char)[0] in {"L", "N"}
    )


def parse_chapter_specs(p4_output: str) -> list[ChapterSpec]:
    """Parse old chapter lines and new lines carrying an exact script anchor."""
    lines = (p4_output or "").splitlines()
    start_index = next(
        (index for index, line in enumerate(lines) if "チャプター設計" in line),
        None,
    )
    if start_index is None:
        return []

    specs: list[ChapterSpec] = []
    for line in lines[start_index + 1 :]:
        stripped = line.strip()
        if specs and stripped.startswith("■"):
            break
        match = _CHAPTER_LINE_RE.match(line)
        if not match:
            continue
        seconds_part = int(match.group(2))
        if seconds_part >= 60:
            continue
        body = match.group(3).strip()
        anchor_match = _ANCHOR_RE.search(body)
        anchor = anchor_match.group(1).strip() if anchor_match else None
        title = body[: anchor_match.start()].strip() if anchor_match else body
        if not title:
            continue
        specs.append(
            ChapterSpec(
                estimated_seconds=int(match.group(1)) * 60 + seconds_part,
                title=title,
                anchor=anchor or None,
            )
        )
    return specs


def _source_index(cards: list[Card]) -> tuple[str, list[float]]:
    source_parts: list[str] = []
    character_times: list[float] = []
    for card in cards:
        normalized = _normalize_match_text("".join(card.lines))
        source_parts.append(normalized)
        character_times.extend([card.start] * len(normalized))
    return "".join(source_parts), character_times


def _nearest_cue(cards: list[Card], target: float, minimum: float, maximum: float) -> float:
    valid = [card.start for card in cards if minimum <= card.start <= maximum]
    if not valid:
        return min(max(target, minimum), maximum)
    return min(valid, key=lambda seconds: abs(seconds - target))


def _anchor_candidates(
    anchor: str,
    source_text: str,
    character_times: list[float],
    base_seconds: float,
    duration: float,
) -> list[_Candidate]:
    normalized_anchor = _normalize_match_text(anchor)
    if not normalized_anchor:
        return []
    candidates: list[_Candidate] = []
    position = source_text.find(normalized_anchor)
    while position >= 0:
        seconds = character_times[position]
        distance = abs(seconds - base_seconds) / max(duration, 1.0)
        candidates.append(
            _Candidate(
                seconds=seconds,
                method="anchor",
                confidence=1.0,
                score=4.0 - 0.2 * distance,
            )
        )
        position = source_text.find(normalized_anchor, position + 1)
    return candidates


def _fuzzy_candidates(
    title: str,
    cards: list[Card],
    base_seconds: float,
    duration: float,
) -> list[_Candidate]:
    normalized_title = _normalize_match_text(title)
    if not normalized_title:
        return []

    candidates: list[_Candidate] = []
    for card_index, card in enumerate(cards):
        combined = ""
        for end_index in range(card_index, min(card_index + 3, len(cards))):
            combined += _normalize_match_text("".join(cards[end_index].lines))
            if not combined:
                continue
            confidence = difflib.SequenceMatcher(
                None,
                normalized_title,
                combined,
                autojunk=False,
            ).ratio()
            if confidence < MIN_FUZZY_CONFIDENCE:
                continue
            distance = abs(card.start - base_seconds) / max(duration, 1.0)
            candidates.append(
                _Candidate(
                    seconds=card.start,
                    method="fuzzy",
                    confidence=confidence,
                    score=confidence - 0.3 * distance,
                )
            )
            if len(combined) >= math.ceil(len(normalized_title) * 1.5):
                break

    candidates.sort(key=lambda candidate: candidate.score, reverse=True)
    return candidates[:MAX_FUZZY_CANDIDATES]


def _dedupe_candidates(candidates: list[_Candidate]) -> list[_Candidate]:
    best_by_millisecond: dict[int, _Candidate] = {}
    for candidate in candidates:
        key = round(candidate.seconds * 1000)
        current = best_by_millisecond.get(key)
        if current is None or candidate.score > current.score:
            best_by_millisecond[key] = candidate
    return sorted(best_by_millisecond.values(), key=lambda candidate: candidate.seconds)


def _limit_specs(specs: list[ChapterSpec], duration: float) -> list[ChapterSpec]:
    max_count = int(duration // MIN_CHAPTER_GAP_SECONDS) + 1
    if max_count < 3:
        return []
    if len(specs) <= max_count:
        return specs
    indexes = {
        round(index * (len(specs) - 1) / (max_count - 1))
        for index in range(max_count)
    }
    return [specs[index] for index in sorted(indexes)]


def _fallback_sequence(
    specs: list[ChapterSpec],
    cards: list[Card],
    base_times: list[float],
    duration: float,
) -> list[ResolvedChapter]:
    resolved: list[ResolvedChapter] = []
    for index, (spec, base_seconds) in enumerate(zip(specs, base_times)):
        if index == 0:
            seconds = 0.0
        else:
            minimum = resolved[-1].seconds + MIN_CHAPTER_GAP_SECONDS
            remaining_chapters = len(specs) - index - 1
            maximum = duration - MIN_CHAPTER_GAP_SECONDS * remaining_chapters
            seconds = _nearest_cue(cards, base_seconds, minimum, maximum)
        resolved.append(
            ResolvedChapter(
                seconds=seconds,
                title=spec.title,
                estimated_seconds=spec.estimated_seconds,
                anchor=spec.anchor,
                method="scaled",
                confidence=0.0,
            )
        )
    return resolved


def resolve_chapters(
    specs: list[ChapterSpec],
    cards: list[Card],
    *,
    duration_seconds: float | None = None,
) -> list[ResolvedChapter]:
    """Resolve chapters with exact anchors first and ordered fuzzy fallback."""
    valid_cards = [card for card in cards if card.lines and card.end > card.start]
    if len(specs) < 3 or not valid_cards:
        return []

    card_duration = max(card.end for card in valid_cards)
    duration = (
        min(card_duration, duration_seconds)
        if duration_seconds is not None and duration_seconds > 0
        else card_duration
    )
    specs = _limit_specs(specs, duration)
    if len(specs) < 3:
        return []

    source_text, character_times = _source_index(valid_cards)
    last_estimated = max(specs[-1].estimated_seconds, 1.0)
    last_target = min(
        duration * LEGACY_LAST_CHAPTER_RATIO,
        duration - MIN_CHAPTER_GAP_SECONDS,
    )
    base_times = [
        0.0
        if index == 0
        else spec.estimated_seconds / last_estimated * last_target
        for index, spec in enumerate(specs)
    ]

    candidate_sets: list[list[_Candidate]] = []
    for index, (spec, base_seconds) in enumerate(zip(specs, base_times)):
        if index == 0:
            candidate_sets.append(
                [_Candidate(seconds=0.0, method="forced", confidence=1.0, score=5.0)]
            )
            continue

        minimum = index * MIN_CHAPTER_GAP_SECONDS
        remaining_chapters = len(specs) - index - 1
        maximum = duration - MIN_CHAPTER_GAP_SECONDS * remaining_chapters
        candidates: list[_Candidate] = []
        if spec.anchor:
            candidates.extend(
                _anchor_candidates(
                    spec.anchor,
                    source_text,
                    character_times,
                    base_seconds,
                    duration,
                )
            )
        candidates.extend(
            _fuzzy_candidates(spec.title, valid_cards, base_seconds, duration)
        )
        fallback_seconds = _nearest_cue(
            valid_cards,
            base_seconds,
            minimum,
            maximum,
        )
        candidates.append(
            _Candidate(
                seconds=fallback_seconds,
                method="scaled",
                confidence=0.0,
                score=0.25,
            )
        )
        candidate_sets.append(
            [
                candidate
                for candidate in _dedupe_candidates(candidates)
                if minimum <= candidate.seconds <= maximum
            ]
        )

    paths: dict[int, tuple[float, list[_Candidate]]] = {
        0: (candidate_sets[0][0].score, [candidate_sets[0][0]])
    }
    for chapter_index in range(1, len(candidate_sets)):
        next_paths: dict[int, tuple[float, list[_Candidate]]] = {}
        for candidate_index, candidate in enumerate(candidate_sets[chapter_index]):
            best: tuple[float, list[_Candidate]] | None = None
            for previous_score, previous_path in paths.values():
                if (
                    candidate.seconds - previous_path[-1].seconds
                    < MIN_CHAPTER_GAP_SECONDS
                ):
                    continue
                proposal = (
                    previous_score + candidate.score,
                    [*previous_path, candidate],
                )
                if best is None or proposal[0] > best[0]:
                    best = proposal
            if best is not None:
                next_paths[candidate_index] = best
        paths = next_paths
        if not paths:
            return _fallback_sequence(specs, valid_cards, base_times, duration)

    _, best_path = max(paths.values(), key=lambda item: item[0])
    return [
        ResolvedChapter(
            seconds=candidate.seconds,
            title=spec.title,
            estimated_seconds=spec.estimated_seconds,
            anchor=spec.anchor,
            method=candidate.method,
            confidence=candidate.confidence,
        )
        for spec, candidate in zip(specs, best_path)
    ]


def format_chapter_timestamp(seconds: float) -> str:
    total_seconds = max(int(seconds), 0)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds_part = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds_part:02d}"
    return f"{minutes:02d}:{seconds_part:02d}"


def format_chapter_lines(chapters: list[ResolvedChapter]) -> str:
    return "\n".join(
        f"{format_chapter_timestamp(chapter.seconds)} {chapter.title}"
        for chapter in chapters
    )


def replace_description_chapters(
    description: str,
    chapters: list[ResolvedChapter],
) -> str | None:
    if not description or len(chapters) < 3:
        return None
    chapter_lines = format_chapter_lines(chapters)
    if not _DESCRIPTION_CHAPTER_RE.search(description):
        return None
    return _DESCRIPTION_CHAPTER_RE.sub(
        lambda match: f"{match.group(1)}{chapter_lines}{match.group(2)}",
        description,
        count=1,
    )
