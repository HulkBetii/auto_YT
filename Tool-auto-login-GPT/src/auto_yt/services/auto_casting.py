"""Deterministic profile-based voice casting for multi-speaker videos."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Any, Iterable

from auto_yt.dialogue_parser import parse_dialogue_turns
from auto_yt.services.voice_config import normalize_casting_profile


class AutoCastingAttentionRequired(RuntimeError):
    """Raised when a safe distinct cast cannot be produced automatically."""


def normalize_speaker_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    ascii_value = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^A-Z0-9]+", "_", ascii_value.upper()).strip("_") or "SPEAKER"


def _infer_attributes(speaker_key: str) -> tuple[str, str, float]:
    tokens = set(normalize_speaker_key(speaker_key).split("_"))
    female_tokens = {"NU", "BA", "CO", "CHI", "ME", "VO", "GIRL", "WOMAN"}
    male_tokens = {"NAM", "ONG", "ANH", "BO", "CHONG", "BOY", "MAN"}
    young_tokens = {"TRE", "BE", "CON", "YOUNG", "TEEN"}
    senior_tokens = {"GIA", "CU", "ELDER", "SENIOR"}
    gender = "female" if tokens & female_tokens else "male" if tokens & male_tokens else "any"
    age_group = "young" if tokens & young_tokens else "senior" if tokens & senior_tokens else "any"
    confidence = 0.75 if gender != "any" or age_group != "any" else 0.35
    return gender, age_group, confidence


def _provided_manifest_map(value: object) -> dict[str, dict]:
    entries: Iterable[Any]
    if isinstance(value, dict):
        entries = value.get("speakers") if isinstance(value.get("speakers"), list) else []
    elif isinstance(value, list):
        entries = value
    else:
        entries = []
    result: dict[str, dict] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        key = normalize_speaker_key(
            str(entry.get("speaker_key") or entry.get("role") or entry.get("name") or "")
        )
        result[key] = dict(entry)
    return result


def build_speaker_manifest(
    script: str,
    *,
    provided_manifest: object = None,
    cast_settings: object = None,
) -> list[dict]:
    turns = parse_dialogue_turns(script)
    provided = _provided_manifest_map(provided_manifest)
    cast = cast_settings if isinstance(cast_settings, dict) else {}
    speaker_keys: list[str] = []
    for turn in turns:
        key = normalize_speaker_key(turn.get("role") or "")
        if key not in speaker_keys:
            speaker_keys.append(key)
    manifest: list[dict] = []
    for key in speaker_keys:
        supplied = provided.get(key, {})
        cast_key = "mc" if key == "MC" else key.casefold()
        role_cast = cast.get(cast_key) or cast.get(key) or {}
        desired = role_cast.get("casting_profile") if isinstance(role_cast, dict) else {}
        inferred_gender, inferred_age, inferred_confidence = _infer_attributes(key)
        gender = str(supplied.get("gender") or (desired or {}).get("gender") or inferred_gender).casefold()
        age_group = str(
            supplied.get("age_group") or (desired or {}).get("age_group") or inferred_age
        ).casefold()
        language = str(
            supplied.get("language") or (desired or {}).get("language") or "vi"
        ).casefold()
        styles = supplied.get("styles") or (desired or {}).get("styles") or []
        if not isinstance(styles, list):
            styles = []
        confidence = supplied.get("confidence", inferred_confidence)
        try:
            confidence = min(1.0, max(0.0, float(confidence)))
        except (TypeError, ValueError):
            confidence = inferred_confidence
        manifest.append(
            {
                "speaker_key": key,
                "speaker_name": str(supplied.get("name") or key).strip(),
                "role": "mc" if key == "MC" else "guest",
                "gender": gender if gender in {"any", "male", "female"} else "any",
                "age_group": (
                    age_group
                    if age_group in {"any", "young", "adult", "senior"}
                    else "any"
                ),
                "language": language or "vi",
                "styles": [str(item).strip().casefold() for item in styles if str(item).strip()],
                "confidence": confidence,
            }
        )
    return manifest


def profile_signature(manifest_entry: dict) -> str:
    payload = {
        key: manifest_entry.get(key)
        for key in ("gender", "age_group", "language", "styles", "role")
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def _score_voice(manifest: dict, voice: dict) -> float | None:
    profile = normalize_casting_profile(voice.get("casting_profile"))
    if not profile["auto_cast"] or str(voice.get("status") or "active") != "active":
        return None
    desired_gender = str(manifest.get("gender") or "any")
    desired_age = str(manifest.get("age_group") or "any")
    language = str(manifest.get("language") or "vi")
    role = str(manifest.get("role") or "guest")
    if desired_gender != "any" and profile["gender"] not in {"any", desired_gender}:
        return None
    if desired_age != "any" and profile["age_group"] not in {"any", desired_age}:
        return None
    if profile["languages"] and language not in profile["languages"] and "any" not in profile["languages"]:
        return None
    if profile["roles"] and role not in profile["roles"] and "any" not in profile["roles"]:
        return None
    score = 20.0
    if desired_gender != "any":
        score += 35.0 if profile["gender"] == desired_gender else 12.0
    elif profile["gender"] != "any":
        score += 4.0
    if desired_age != "any":
        score += 25.0 if profile["age_group"] == desired_age else 8.0
    elif profile["age_group"] != "any":
        score += 3.0
    if language in profile["languages"]:
        score += 15.0
    if role in profile["roles"]:
        score += 10.0
    desired_styles = set(manifest.get("styles") or [])
    score += min(15.0, 5.0 * len(desired_styles & set(profile["styles"])))
    return score


def assign_cast(
    manifest: list[dict],
    voices: list[dict],
    *,
    mc_voice_id: str,
    registry: dict[str, dict] | None = None,
) -> list[dict]:
    voice_by_id = {str(voice.get("id") or ""): voice for voice in voices}
    mc_id = str(mc_voice_id or "").strip()
    if not mc_id or mc_id not in voice_by_id or voice_by_id[mc_id].get("status") != "active":
        raise AutoCastingAttentionRequired("Giọng MC cố định không còn hoạt động.")
    assignments: list[dict] = []
    used = {mc_id}
    registry = registry or {}
    for speaker in manifest:
        key = normalize_speaker_key(str(speaker.get("speaker_key") or ""))
        if speaker.get("role") == "mc" or key == "MC":
            assignments.append(
                {
                    **speaker,
                    "speaker_key": key,
                    "role_key": "MC",
                    "voice_id": mc_id,
                    "match_score": 100.0,
                    "source": "fixed_mc",
                }
            )
            continue
        stable_voice_id = str((registry.get(key) or {}).get("voice_id") or "")
        stable_score = (
            _score_voice(speaker, voice_by_id[stable_voice_id])
            if stable_voice_id in voice_by_id and stable_voice_id not in used
            else None
        )
        if stable_score is not None:
            selected_id = stable_voice_id
            score = stable_score + 100.0
            source = "registry"
        else:
            candidates = []
            for voice_id, voice in voice_by_id.items():
                if voice_id in used:
                    continue
                voice_score = _score_voice(speaker, voice)
                if voice_score is not None:
                    candidates.append((voice_score, voice_id))
            if not candidates:
                raise AutoCastingAttentionRequired(
                    f"Không có giọng auto-cast phù hợp và khác biệt cho {speaker.get('speaker_name') or key}."
                )
            score, selected_id = max(candidates, key=lambda item: (item[0], item[1]))
            source = "profile_match"
        used.add(selected_id)
        assignments.append(
            {
                **speaker,
                "speaker_key": key,
                "role_key": key,
                "voice_id": selected_id,
                "match_score": round(float(score), 2),
                "source": source,
            }
        )
    return assignments
