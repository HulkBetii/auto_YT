"""Shared validation and conservative repair helpers for generated metadata."""

from __future__ import annotations

import html
import re
import unicodedata


_SECTION_PATTERN = re.compile(
    r"(?ms)^(?P<header>#{0,6}\s*\[(?P<label>[^\]]+)\]\s*\n)"
    r"(?P<body>.*?)(?=^#{0,6}\s*\[[^\]]+\]\s*$|\Z)"
)


def normalize_metadata_text(value: object) -> str:
    text = html.unescape(str(value or ""))
    text = (
        text.replace("\u00a0", " ")
        .replace("\u200b", "")
        .replace("\u200c", "")
        .replace("\u200d", "")
        .replace("\ufeff", "")
    )
    return unicodedata.normalize("NFC", text).strip()


def is_likely_slug(value: object) -> bool:
    text = normalize_metadata_text(value)
    return bool(
        text
        and len(text) <= 100
        and re.fullmatch(r"[a-z0-9]+(?:[-_][a-z0-9]+)*", text)
    )


def is_likely_title(value: object) -> bool:
    text = normalize_metadata_text(value)
    if not 10 <= len(text) <= 100 or "\n" in text or is_likely_slug(text):
        return False
    lowered = text.casefold()
    disallowed_markers = (
        "đăng ký kênh",
        "nhấn like",
        "bật chuông",
        "miễn trừ trách nhiệm",
        "hãy xem đến cuối",
    )
    return len(text.split()) >= 3 and not any(marker in lowered for marker in disallowed_markers)


def is_likely_description(value: object) -> bool:
    text = normalize_metadata_text(value)
    if not 80 <= len(text) <= 5000 or is_likely_slug(text):
        return False
    if "\n" not in text and len(text) <= 100 and "|" in text:
        return False
    return True


def metadata_component_error(component: str, value: object) -> str:
    text = normalize_metadata_text(value)
    if component == "title":
        if not text:
            return "missing title"
        if len(text) > 100:
            return "title exceeds 100 characters"
        if not is_likely_title(text):
            return "title has an invalid shape"
        return ""
    if component == "slug":
        return "" if is_likely_slug(text) else "slug is not a canonical URL slug"
    if component == "description":
        if not text:
            return "missing description"
        if len(text) < 80:
            return "description is shorter than 80 characters"
        if len(text) > 5000:
            return "description exceeds 5000 characters"
        if not is_likely_description(text):
            return "description looks like another metadata field"
        return ""
    raise ValueError(f"Unsupported metadata component: {component}")


def validate_required_metadata(state: dict, pipeline: dict) -> list[str]:
    errors: list[str] = []
    for component in ("title", "slug", "description"):
        if not pipeline.get(component, True):
            continue
        error = metadata_component_error(component, state.get(component, ""))
        if error:
            errors.append(f"{component}: {error}")
    title = normalize_metadata_text(state.get("title"))
    description = normalize_metadata_text(state.get("description"))
    if title and description and title.casefold() == description.casefold():
        errors.append("title and description are duplicated")
    return errors


def metadata_is_unambiguously_swapped(title: object, description: object) -> bool:
    title_text = normalize_metadata_text(title)
    description_text = normalize_metadata_text(description)
    return bool(
        metadata_component_error("title", title_text)
        and not metadata_component_error("description", title_text)
        and not metadata_component_error("title", description_text)
    )


def repair_swapped_script_metadata(script: str) -> tuple[str, bool]:
    """Swap title/description sections only when their shapes are unambiguous."""
    matches = list(_SECTION_PATTERN.finditer(str(script or "")))
    title_match = next(
        (m for m in matches if _normalize_label(m.group("label")) in {"TIEU DE", "TIEU DE VIDEO"}),
        None,
    )
    description_match = next(
        (m for m in matches if _normalize_label(m.group("label")) in {"MO TA", "MO TA VIDEO"}),
        None,
    )
    if not title_match or not description_match:
        return script, False

    title = title_match.group("body").strip()
    description = description_match.group("body").strip()
    if not metadata_is_unambiguously_swapped(title, description):
        return script, False

    replacements = [
        (title_match.start("body"), title_match.end("body"), f"{description}\n\n"),
        (description_match.start("body"), description_match.end("body"), f"{title}\n"),
    ]
    repaired = script
    for start, end, value in sorted(replacements, reverse=True):
        repaired = repaired[:start] + value + repaired[end:]
    return repaired, True


def _normalize_label(value: str) -> str:
    text = str(value or "").replace("Đ", "D").replace("đ", "d")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", text).strip().upper()
