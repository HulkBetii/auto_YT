"""
metadata_gate.py
================
Pre-publish gate: one PASS / WARN / FAIL verdict for a web_ko_jp upload kit.

Why: the old audit only checked lengths and printed "READY TO UPLOAD" for a v5 description that
still carried "【BLOCK 2 — KÊNH NÀY DÀNH CHO AI】". Each check maps to a defect seen on the channel
or a YouTube rule. FAIL = do not upload until fixed; WARN = review before upload.
(Same idea as recap_comics/prepublish_gate.py.)
"""
import re
from typing import Any, Dict, List, Literal, Optional, Sequence

from pydantic import BaseModel, Field

from channel_profile import HASHTAG_MAX, HASHTAG_MIN, TITLE_DISPLAY_MAX, TITLE_HARD_MAX
from metadata_rules import (
    BLOCK_LINE_RE,
    PLACEHOLDER_TIMESTAMP_RE,
    bigram_coverage,
    count_circled_chapters,
    count_hashtags,
    counted_numbers,
    has_vietnamese,
    longest_common_substring,
    strip_leading_bracket,
)
from timestamp_sync import parse_timestamp_sec
from title_validator import validate_title

Severity = Literal["fail", "warn"]
GateStatus = Literal["PASS", "WARN", "FAIL"]

DESCRIPTION_MAX_BYTES = 5000        # YouTube Data API limit
HASHTAG_IGNORED_ABOVE = 60
TAGS_MAX_CHARS = 500
MIN_CHAPTERS = 3
MIN_CHAPTER_SECONDS = 10            # YouTube ignores chapter lists with shorter chapters
# An em/en dash right after the timestamp hid every chapter on recap_comics' channel (2026-10-02).
CHAPTER_LINE_RE = re.compile(r"^(\d{1,2}:\d{2}(?::\d{2})?) (?![—–])\S")
AI_DISCLOSURE_PHRASES = ("合成音声", "AI音声", "音声合成")
THUMBNAIL_REPEAT_MIN_CHARS = 4
OPENING_CHARS = 400                  # ~first 60-90 seconds of narration
MIN_PROMISE_COVERAGE = 0.3
DUPLICATE_REASON_PREFIX = "near-duplicate"


class GateCheck(BaseModel):
    id: str
    severity: Severity
    passed: bool
    detail: str = ""


class GateReport(BaseModel):
    status: GateStatus
    checks: List[GateCheck] = Field(default_factory=list)

    @property
    def failures(self) -> List[GateCheck]:
        return [c for c in self.checks if not c.passed and c.severity == "fail"]

    @property
    def warnings(self) -> List[GateCheck]:
        return [c for c in self.checks if not c.passed and c.severity == "warn"]


def check_description_clean(description: str) -> GateCheck:
    problems = []
    if any(BLOCK_LINE_RE.search(line) for line in description.splitlines()):
        problems.append("prompt BLOCK header")
    if has_vietnamese(description):
        problems.append("Vietnamese text")
    if PLACEHOLDER_TIMESTAMP_RE.search(description):
        problems.append("XX:XX placeholder")
    return GateCheck(id="description_clean", severity="fail", passed=not problems, detail=", ".join(problems))


def check_title(title: str, script_jp: str, transcript: str, registry_titles: Sequence[str]) -> List[GateCheck]:
    """Re-validates the title actually shipped (it may differ from Turn 2 after manual edits)."""
    result = validate_title(title, script_jp=script_jp, transcript=transcript, registry_titles=registry_titles)
    dup = [r for r in result.reasons if r.startswith(DUPLICATE_REASON_PREFIX)]
    other = [r for r in result.reasons if not r.startswith(DUPLICATE_REASON_PREFIX)]
    return [
        GateCheck(id="title_validated", severity="fail", passed=not other, detail="; ".join(other)),
        GateCheck(id="title_not_duplicate", severity="fail", passed=not dup, detail="; ".join(dup)),
    ]


def check_chapters(chapter_lines: Sequence[str], duration_sec: Optional[float]) -> GateCheck:
    problems: List[str] = []
    if len(chapter_lines) < MIN_CHAPTERS:
        problems.append(f"{len(chapter_lines)} chapters (< {MIN_CHAPTERS})")
    seconds: List[float] = []
    for line in chapter_lines:
        m = CHAPTER_LINE_RE.match(line)
        if not m:
            problems.append(f"bad line '{line}'")
            continue
        seconds.append(parse_timestamp_sec(m.group(1)))
    if seconds and seconds[0] != 0:
        problems.append("first chapter is not 00:00")
    for prev, cur in zip(seconds, seconds[1:]):
        if cur - prev < MIN_CHAPTER_SECONDS:
            problems.append(f"chapter at {cur:.0f}s is < {MIN_CHAPTER_SECONDS}s after the previous one")
    if duration_sec and seconds and seconds[-1] >= duration_sec - MIN_CHAPTER_SECONDS:
        problems.append(f"last chapter {seconds[-1]:.0f}s is past the end ({duration_sec:.0f}s)")
    return GateCheck(id="chapters_valid", severity="fail", passed=not problems, detail="; ".join(problems))


def check_title_number(title: str, chapter_lines: Sequence[str]) -> GateCheck:
    promised = counted_numbers(title)
    numbered = count_circled_chapters(chapter_lines)
    passed = not promised or not numbered or numbered in promised
    detail = "" if passed else f"title promises {sorted(promised)}, description has {numbered} numbered chapters"
    return GateCheck(id="title_number_matches_chapters", severity="fail", passed=passed, detail=detail)


def check_limits(title: str, description: str, tags_flat: str) -> GateCheck:
    problems = []
    if len(title) > TITLE_HARD_MAX:
        problems.append(f"title {len(title)} chars > {TITLE_HARD_MAX}")
    if len(description.encode("utf-8")) > DESCRIPTION_MAX_BYTES:
        problems.append(f"description {len(description.encode('utf-8'))} bytes > {DESCRIPTION_MAX_BYTES}")
    if len(tags_flat) > TAGS_MAX_CHARS:
        problems.append(f"tags {len(tags_flat)} chars > {TAGS_MAX_CHARS}")
    if re.search(r"[<>]", title + description):
        problems.append("'<' or '>' (rejected by YouTube)")
    return GateCheck(id="youtube_limits", severity="fail", passed=not problems, detail="; ".join(problems))


def check_thumbnail_clean(thumbnail_text: str) -> GateCheck:
    passed = bool(thumbnail_text.strip()) and not has_vietnamese(thumbnail_text)
    detail = "" if passed else ("missing" if not thumbnail_text.strip() else "contains Vietnamese prompt text")
    return GateCheck(id="thumbnail_clean", severity="fail", passed=passed, detail=detail)


def check_thumbnail(title: str, thumbnail_text: str) -> GateCheck:
    if not thumbnail_text.strip():
        return GateCheck(id="thumbnail_repeats_title", severity="warn", passed=True, detail="no thumbnail text")
    problems = []
    for line in thumbnail_text.splitlines():
        common = longest_common_substring(line, strip_leading_bracket(title))
        if len(common) >= THUMBNAIL_REPEAT_MIN_CHARS:
            problems.append(f"'{common}' repeats the title")
    extra_numbers = counted_numbers(thumbnail_text) - counted_numbers(title)
    if extra_numbers:
        problems.append(f"numbers {sorted(extra_numbers)} not in the title")
    return GateCheck(id="thumbnail_repeats_title", severity="warn", passed=not problems, detail="; ".join(problems))


def check_promise_in_opening(title: str, script_jp: str) -> GateCheck:
    promise = strip_leading_bracket(title).split("｜")[0]
    coverage = bigram_coverage(promise, (script_jp or "")[:OPENING_CHARS])
    passed = coverage >= MIN_PROMISE_COVERAGE
    return GateCheck(
        id="title_promise_in_opening", severity="warn", passed=passed,
        detail=f"{coverage:.0%} of the title's promise appears in the first {OPENING_CHARS} chars of the script",
    )


def run_gate(
    *,
    title: str,
    description: str,
    chapter_lines: Sequence[str],
    script_jp: str,
    transcript: str = "",
    registry_titles: Sequence[str] = (),
    chapter_sync: Optional[Sequence[Dict[str, Any]]] = None,
    duration_sec: Optional[float] = None,
    tags_flat: str = "",
    thumbnail_text: str = "",
    pinned_comment: str = "",
    srt_exists: bool = False,
) -> GateReport:
    interpolated = [c["title"] for c in (chapter_sync or []) if c.get("source") == "interpolated"]
    hashtags = count_hashtags(description)
    checks = [
        check_description_clean(description),
        *check_title(title, script_jp, transcript, registry_titles),
        check_chapters(chapter_lines, duration_sec),
        check_title_number(title, chapter_lines),
        # YouTube ignores every hashtag above 60; 3-5 is the recommendation, not a rule.
        GateCheck(
            id="hashtags_ignored", severity="fail", passed=hashtags <= HASHTAG_IGNORED_ABOVE,
            detail=f"{hashtags} hashtags",
        ),
        GateCheck(
            id="hashtags_3_to_5", severity="warn", passed=HASHTAG_MIN <= hashtags <= HASHTAG_MAX,
            detail=f"{hashtags} hashtags",
        ),
        GateCheck(
            id="ai_disclosure", severity="fail",
            passed=any(p in description for p in AI_DISCLOSURE_PHRASES),
            detail="" if any(p in description for p in AI_DISCLOSURE_PHRASES) else "no 合成音声/AI音声 note",
        ),
        check_limits(title, description, tags_flat),
        GateCheck(
            id="title_display_length", severity="warn", passed=len(title) <= TITLE_DISPLAY_MAX,
            detail=f"{len(title)} chars (mobile shows ~{TITLE_DISPLAY_MAX})",
        ),
        GateCheck(
            id="chapters_interpolated", severity="warn", passed=not interpolated,
            detail=("guessed timestamps: " + ", ".join(interpolated)) if interpolated
            else ("" if chapter_sync is not None else "no sync record (older output)"),
        ),
        check_thumbnail_clean(thumbnail_text),
        check_thumbnail(title, thumbnail_text),
        check_promise_in_opening(title, script_jp),
        GateCheck(id="captions_file", severity="warn", passed=srt_exists,
                  detail="" if srt_exists else "no SRT to upload as Japanese captions"),
        GateCheck(id="pinned_comment", severity="warn", passed=bool(pinned_comment.strip()),
                  detail="" if pinned_comment.strip() else "missing"),
    ]
    if any(not c.passed and c.severity == "fail" for c in checks):
        status: GateStatus = "FAIL"
    elif any(not c.passed for c in checks):
        status = "WARN"
    else:
        status = "PASS"
    return GateReport(status=status, checks=checks)


def render_gate_banner(report: GateReport) -> List[str]:
    headline = {
        "PASS": "✅ PASS — ready to upload",
        "WARN": "⚠ WARN — review the items below before uploading",
        "FAIL": "❌ FAIL — do not upload until the items below are fixed",
    }[report.status]
    lines = [f"PRE-PUBLISH GATE: {headline}"]
    for check in report.failures:
        lines.append(f"  ❌ {check.id}: {check.detail}")
    for check in report.warnings:
        lines.append(f"  ⚠ {check.id}: {check.detail}")
    return lines
