# -*- coding: utf-8 -*-
import sys
import os
import re
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("script_parser")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
PROFILES_FILE = REPO_ROOT / "web_vn" / "data" / "voice_profiles" / "voices.json"

SPEAKER_ALIAS_MAP = {
    "bac_sam": "bac_sam",
    "sam": "bac_sam",
    "van_sam": "bac_sam",
    "narrator": "bac_sam",
    "nhan_vat_chinh": "nhan_vat_chinh",
    "nu_chinh": "nhan_vat_chinh",
    "ha": "nhan_vat_chinh",
    "minh_ha": "nhan_vat_chinh",
    "lan": "nhan_vat_chinh",
    "mai_lan": "nhan_vat_chinh",
    "thu_ha": "nhan_vat_chinh",
    "me_chong": "me_chong",
    "ba_ly": "me_chong",
    "ba_me": "me_chong",
    "me": "me_chong",
    "tieu_tam": "tieu_tam",
    "thanh_vy": "tieu_tam",
    "vy": "tieu_tam",
    "nhan_tinh": "tieu_tam",
    "tra": "tieu_tam",
    "chong_boi_bac": "chong_boi_bac",
    "nguoi_chong": "chong_boi_bac",
    "hung": "chong_boi_bac",
    "duc_trong": "chong_boi_bac",
    "chong": "chong_boi_bac"
}

IGNORE_LINE_PATTERNS = [
    r"^#+\s*kịch\s+bản\s+hoàn\s+chỉnh",
    r"^#+\s*phần\s+\d+",
    r"^dưới\s+đây\s+là\s+bản\s+viết",
    r"^dưới\s+đây\s+là\s+kịch\s+bản",
    r"^master\s+blueprint",
    r"^turn\s+\d+",
    r"^quý\s+vị\s+và\s+các\s+bạn\s+vừa\s+nghe\s+xong\s+hồi",
]

def load_voice_profiles() -> Dict[str, Any]:
    if not PROFILES_FILE.exists():
        logger.error(f"Voice profiles file not found: {PROFILES_FILE}")
        return {}
    return json.loads(PROFILES_FILE.read_text(encoding="utf-8"))

def is_meta_text(text: str) -> bool:
    t_low = text.lower().strip()
    for pat in IGNORE_LINE_PATTERNS:
        if re.search(pat, t_low):
            return True
    return False

def clean_text_for_tts(text: str) -> str:
    text = re.sub(r"#+\s*", "", text)
    text = re.sub(r"\*{1,3}", "", text)
    text = re.sub(r"\[SPEAKER(?::[a-zA-Z0-9_]+)?\]", "", text)
    text = re.sub(r">>\s*", "", text)
    text = re.sub(r"--+|==+", " ", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"\b\d{1,2}:\d{2}(:\d{2})?\b", "", text)
    for q in ['"', '“', '”', "'", '‘', '’']:
        text = text.replace(q, "")
    text = re.sub(r"\s+", " ", text).strip()
    return text

def split_into_sentence_chunks(text: str, max_words: int = 50) -> List[str]:
    raw_sentences = re.split(r"(?<=[.!?…])\s+", text)
    chunks = []
    current_chunk = []
    current_words = 0

    for sent in raw_sentences:
        sent = sent.strip()
        if not sent:
            continue
        words = len(sent.split())
        if words == 0:
            continue

        if current_words + words <= max_words:
            current_chunk.append(sent)
            current_words += words
        else:
            if current_chunk:
                chunks.append(" ".join(current_chunk))
            current_chunk = [sent]
            current_words = words

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks

def parse_script_to_manifest(script_path: Path, output_jsonl: Path) -> List[Dict[str, Any]]:
    voices = load_voice_profiles()
    default_voice = voices.get("bac_sam", {})

    content = script_path.read_text(encoding="utf-8")
    tag_pattern = re.compile(r"(\[SPEAKER(?::[a-zA-Z0-9_]+)?\]|CHƯƠNG\s+\d+[^\[\n\.]*)", re.IGNORECASE)
    tokens = tag_pattern.split(content)

    manifest_entries = []
    current_speaker = "bac_sam"
    current_chapter = 1
    chunk_idx = 1

    for tok in tokens:
        tok_s = tok.strip()
        if not tok_s or is_meta_text(tok_s):
            continue

        if tok_s.upper().startswith("CHƯƠNG"):
            ch_m = re.search(r"CHƯƠNG\s+(\d+)", tok_s, re.I)
            if ch_m:
                current_chapter = int(ch_m.group(1))
            current_speaker = "bac_sam"
            continue

        sp_m = re.match(r"\[SPEAKER(?::([a-zA-Z0-9_]+))?\]", tok_s, re.I)
        if sp_m:
            raw_role = (sp_m.group(1) or "bac_sam").lower()
            current_speaker = SPEAKER_ALIAS_MAP.get(raw_role, "bac_sam")
            continue

        c_text = clean_text_for_tts(tok_s)
        if not c_text or len(c_text.split()) < 2:
            continue

        sub_chunks = split_into_sentence_chunks(c_text, max_words=50)
        v_profile = voices.get(current_speaker, default_voice)

        for sub in sub_chunks:
            entry_id = f"chunk_{chunk_idx:05d}"
            entry = {
                "id": entry_id,
                "chapter": current_chapter,
                "speaker_id": current_speaker,
                "text": sub,
                "words": len(sub.split()),
                "ref_audio": v_profile.get("ref_audio", ""),
                "ref_text": v_profile.get("ref_text", ""),
                "language_id": "vi",
                "speed": v_profile.get("speed", 0.95),
                "guidance_scale": v_profile.get("guidance_scale", 2.5),
                "instruct": v_profile.get("instruct", "")
            }
            manifest_entries.append(entry)
            chunk_idx += 1

    output_jsonl.parent.mkdir(parents=True, exist_ok=True)
    with output_jsonl.open("w", encoding="utf-8") as f:
        for item in manifest_entries:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    total_words = sum(e["words"] for e in manifest_entries)
    logger.info(f"Parsed {len(manifest_entries)} clean audio chunks ({total_words:,} words) across 10 chapters.")
    logger.info(f"Saved manifest to: {output_jsonl}")

    return manifest_entries

if __name__ == "__main__":
    test_script = REPO_ROOT / "web_vn" / "output" / "story_test_01" / "full_story_script.md"
    out_manifest = REPO_ROOT / "web_vn" / "output" / "story_test_01" / "audio_manifest.jsonl"
    if test_script.exists():
        parse_script_to_manifest(test_script, out_manifest)
    else:
        logger.error(f"Script not found at: {test_script}")
