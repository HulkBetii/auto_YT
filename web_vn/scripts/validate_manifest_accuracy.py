# -*- coding: utf-8 -*-
"""
Story Audio Manifest Quality & Accuracy Validator.
Automatically audits audio_manifest.jsonl for:
1. 100% valid speaker IDs against registered voice profiles.
2. 0 metadata / markdown / chapter header / timestamp leakage.
3. 0 synthetic emotion tags [...] or stage directions (...).
4. Chunk word length sanity (max 45 words per breath chunk).
5. Comprehensive multi-role distribution metrics.
"""

import sys
import os
import re
import json
import argparse
import logging
from pathlib import Path
from typing import Dict, Any, List, Tuple
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("manifest_validator")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
PROFILES_FILE = REPO_ROOT / "web_vn" / "data" / "voice_profiles" / "voices.json"

LEAK_PATTERNS = [
    r"^#+",
    r"\bchương\s*\d+\b",
    r"\bhồi\s*\d+\b",
    r"\bturn\s*\d+\b",
    r"\bblueprint\b",
    r"\bkịch\s+bản\b",
    r"\[.*?\]",
    r"\(.*?\)",
    r"https?://",
    r"\b\d{1,2}:\d{2}(:\d{2})?\b",
    r"^(?:bác\s+sâm|nhân\s+vật\s+chính|mẹ\s+chồng|tiểu\s+tam|chồng\s+bội\s+bạc)\s*:"
]

def validate_manifest(manifest_path: Path) -> Tuple[bool, Dict[str, Any]]:
    if not manifest_path.exists():
        logger.error(f"Manifest not found: {manifest_path}")
        return False, {"error": "File not found"}

    if not PROFILES_FILE.exists():
        logger.error(f"Voice profiles file not found: {PROFILES_FILE}")
        return False, {"error": "Voice profiles not found"}

    profiles = json.loads(PROFILES_FILE.read_text(encoding="utf-8"))
    valid_speaker_ids = set(profiles.keys())

    lines = [line.strip() for line in manifest_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not lines:
        logger.error("Manifest is empty!")
        return False, {"error": "Manifest is empty"}

    entries = [json.loads(line) for line in lines]
    total_chunks = len(entries)
    total_words = sum(e.get("words", len(e.get("text", "").split())) for e in entries)

    violations = []
    speaker_counts = Counter()
    chapter_counts = Counter()

    for idx, e in enumerate(entries, start=1):
        c_id = e.get("id", f"chunk_{idx}")
        spk = e.get("speaker_id")
        text = e.get("text", "")
        chapter = e.get("chapter", 1)
        words = len(text.split())

        speaker_counts[spk] += 1
        chapter_counts[chapter] += 1

        # Check 1: Speaker ID validity
        if spk not in valid_speaker_ids:
            violations.append({
                "chunk_id": c_id,
                "type": "INVALID_SPEAKER_ID",
                "detail": f"Unknown speaker_id '{spk}'. Must be one of {valid_speaker_ids}."
            })

        # Check 2: Meta leakage / tags
        for pat in LEAK_PATTERNS:
            if re.search(pat, text, re.IGNORECASE):
                violations.append({
                    "chunk_id": c_id,
                    "type": "META_OR_TAG_LEAKAGE",
                    "detail": f"Matched leak pattern '{pat}' in text: {text[:60]!r}"
                })
                break

        # Check 3: Chunk length
        if words > 45:
            violations.append({
                "chunk_id": c_id,
                "type": "CHUNK_TOO_LONG",
                "detail": f"Chunk has {words} words (recommended max: 35 for natural breath pauses)."
            })

    is_valid = len(violations) == 0
    stats = {
        "is_valid": is_valid,
        "total_chunks": total_chunks,
        "total_words": total_words,
        "estimated_duration_min": round(total_words / 125, 2),
        "total_chapters": len(chapter_counts),
        "chapter_distribution": dict(sorted(chapter_counts.items())),
        "speaker_distribution": dict(speaker_counts),
        "violations_count": len(violations),
        "violations": violations[:20]
    }

    return is_valid, stats

def main():
    parser = argparse.ArgumentParser(description="Story Audio Manifest Quality & Accuracy Validator")
    parser.add_argument("--story-id", type=str, default="e2e_test_01", help="Story ID to validate")
    parser.add_argument("--manifest", type=str, default=None, help="Explicit path to manifest jsonl")
    args = parser.parse_args()

    if args.manifest:
        m_path = Path(args.manifest)
    else:
        s_id = args.story_id if args.story_id.startswith("story_") else f"story_{args.story_id}"
        m_path = REPO_ROOT / "web_vn" / "output" / s_id / "audio_manifest.jsonl"

    logger.info(f"Auditing manifest at: {m_path}")
    is_valid, stats = validate_manifest(m_path)

    print("\n" + "=" * 60)
    print("           AUDIO MANIFEST QUALITY AUDIT REPORT")
    print("=" * 60)
    print(f"Status              : {'[PASSED - 100% CLEAN]' if is_valid else '[FAILED]'}")
    print(f"Total Audio Chunks  : {stats.get('total_chunks', 0):,}")
    print(f"Total Words         : {stats.get('total_words', 0):,}")
    print(f"Est. Story Duration : ~{stats.get('estimated_duration_min', 0)} minutes")
    print(f"Total Chapters      : {stats.get('total_chapters', 0)}")
    print(f"Chapters Breakdown  : {stats.get('chapter_distribution')}")
    print(f"Speaker Breakdown   : {stats.get('speaker_distribution')}")
    print(f"Violations Count    : {stats.get('violations_count', 0)}")
    print("=" * 60)

    if not is_valid:
        print("\nTop Detected Violations:")
        for v in stats.get("violations", []):
            print(f" - [{v['chunk_id']}] {v['type']}: {v['detail']}")
        print("\n" + "=" * 60)
        sys.exit(1)
    else:
        print("\nManifest passed all 5 accuracy criteria! Ready for broadcast TTS synthesis.\n")
        sys.exit(0)

if __name__ == "__main__":
    main()
