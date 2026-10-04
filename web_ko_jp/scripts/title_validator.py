"""
title_validator.py
==================
Deterministic checks on the A/B/C titles ChatGPT drafts in Turn 2.

Why: the four published titles opened with 【99％が知らない】 and three of them were built on
phrases with no Japanese search demand (人生の鉄則, 愚かな行動, 悪人); nothing stopped a title
from promising a count the script does not deliver or citing a classic the source never quoted.
ChatGPT proposes; these rules decide (same split as recap_comics' title_engine).
"""
import re
from typing import Dict, List, Optional, Sequence

from pydantic import BaseModel, Field

from channel_profile import (
    BANNED_TITLE_PATTERNS,
    CLASSIC_SOURCES,
    TITLE_ANCHOR_WINDOW,
    TITLE_ANCHORS,
    TITLE_DISPLAY_MAX,
    TITLE_HARD_MAX,
)
from metadata_rules import char_bigram_jaccard, count_script_items, counted_numbers, normalize, strip_leading_bracket

DUPLICATE_JACCARD = 0.6        # >= this vs an earlier title -> rejected
VARIANT_MAX_JACCARD = 0.5      # A/B/C should differ at least this much for Test & Compare
SCORE_BASE = 10.0
PENALTY_LONG = 2.0
PENALTY_SIMILAR_VARIANT = 1.0
BONUS_PER_EARLY_CHAR = 0.1     # earlier anchor -> slightly higher score


class TitleCheck(BaseModel):
    title: str
    label: str = ""
    passed: bool
    reasons: List[str] = Field(default_factory=list)
    score: float = 0.0
    anchor: str = ""


class TitleValidation(BaseModel):
    status: str                    # "validated" | "failed"
    checks: List[TitleCheck] = Field(default_factory=list)
    retried: bool = False

    def best(self) -> Optional[TitleCheck]:
        passing = [c for c in self.checks if c.passed]
        return max(passing, key=lambda c: c.score) if passing else None


def _anchor_position(title: str) -> Optional[tuple]:
    body = normalize(strip_leading_bracket(title))
    hits = [(body.find(normalize(a)), a) for a in TITLE_ANCHORS if normalize(a) in body]
    return min(hits) if hits else None


def validate_title(
    title: str,
    *,
    script_jp: str,
    transcript: str = "",
    registry_titles: Sequence[str] = (),
    label: str = "",
) -> TitleCheck:
    reasons: List[str] = []
    title = (title or "").strip()
    if not title:
        return TitleCheck(title=title, label=label, passed=False, reasons=["empty title"])

    for pattern in BANNED_TITLE_PATTERNS:
        if re.search(pattern, title):
            reasons.append(f"banned phrase /{pattern}/ (no differentiation, wastes the first characters)")

    if len(title) > TITLE_HARD_MAX:
        reasons.append(f"longer than {TITLE_HARD_MAX} characters")

    anchor = _anchor_position(title)
    if anchor is None:
        reasons.append("no search phrase with JP demand (e.g. 関わってはいけない人, 先人の知恵, 老後)")
    elif anchor[0] > TITLE_ANCHOR_WINDOW:
        reasons.append(f"search phrase '{anchor[1]}' starts at char {anchor[0]}, must be within {TITLE_ANCHOR_WINDOW}")

    items = count_script_items(script_jp)
    promised = counted_numbers(title)
    if items and promised and items not in promised:
        reasons.append(f"title promises {sorted(promised)} items but the script has {items}")

    source_text = (transcript or "").lower()
    for jp_name, vn_names in CLASSIC_SOURCES.items():
        if jp_name in title and jp_name not in script_jp and not any(n in source_text for n in vn_names):
            reasons.append(f"cites {jp_name} but neither the source transcript nor the script quotes it")

    for earlier in registry_titles:
        similarity = char_bigram_jaccard(title, earlier)
        if similarity >= DUPLICATE_JACCARD:
            reasons.append(f"near-duplicate ({similarity:.2f}) of earlier title: {earlier}")
            break

    score = SCORE_BASE
    if len(title) > TITLE_DISPLAY_MAX:
        score -= PENALTY_LONG
    if anchor is not None:
        score += max(TITLE_ANCHOR_WINDOW - anchor[0], 0) * BONUS_PER_EARLY_CHAR
    return TitleCheck(
        title=title, label=label, passed=not reasons, reasons=reasons, score=round(score, 2),
        anchor=anchor[1] if anchor else "",
    )


def validate_variants(
    variants: Dict[str, str],
    *,
    script_jp: str,
    transcript: str = "",
    registry_titles: Sequence[str] = (),
    retried: bool = False,
) -> TitleValidation:
    """Validates {"A": ..., "B": ..., "C": ...}; near-identical variants lose score (Test & Compare
    reports 'Performed Same' for them)."""
    checks = [
        validate_title(t, script_jp=script_jp, transcript=transcript, registry_titles=registry_titles, label=k)
        for k, t in variants.items() if t
    ]
    for i, check in enumerate(checks):
        if any(char_bigram_jaccard(check.title, other.title) > VARIANT_MAX_JACCARD
               for j, other in enumerate(checks) if j != i):
            check.score = round(check.score - PENALTY_SIMILAR_VARIANT, 2)
    status = "validated" if any(c.passed for c in checks) else "failed"
    return TitleValidation(status=status, checks=checks, retried=retried)


def reorder_variants(variants: Dict[str, str], validation: TitleValidation) -> Dict[str, str]:
    """Puts the best passing title in slot A (the kit's primary title); others keep their order."""
    best = validation.best()
    if not best or best.label == "A" or best.label not in variants:
        return dict(variants)
    ordered = [best.title] + [variants[k] for k in ("A", "B", "C") if k != best.label and variants.get(k)]
    return {k: ordered[i] if i < len(ordered) else "" for i, k in enumerate(("A", "B", "C"))}


def retry_feedback(validation: TitleValidation) -> str:
    """Rejection reasons for the Turn 2 retry prompt."""
    return "\n".join(f"- {c.label}: {c.title}\n  → " + "; ".join(c.reasons) for c in validation.checks)
