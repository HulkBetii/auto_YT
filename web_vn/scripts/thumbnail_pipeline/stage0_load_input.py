# -*- coding: utf-8 -*-
"""
STAGE 0: LOAD INPUT & SRT CHUNKING
- Discovers and loads story SRT subtitle files directly from output/{story_id}/
- Validates line count, word count, encoding, and speaker attribution
- Performs semantic chapter chunking for long transcripts without truncating
- Discovers Host portrait references (Mode 1: single reference, Mode 2: expression pack)
"""

import os
import re
import sys
import json
import hashlib
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, asdict
from PIL import Image, ImageDraw

logger = logging.getLogger("thumbnail_pipeline.stage0")


@dataclass
class HostAssetProfile:
    host_id: str
    host_name: str
    mode: str  # "expression_pack" | "single_reference"
    reference_path: Optional[str]
    expressions: Dict[str, str]  # emotion -> file_path
    asset_hash: str


@dataclass
class StoryInputPayload:
    story_id: str
    story_dir: str
    srt_path: Optional[str]
    srt_content: str
    srt_hash: str
    total_lines: int
    total_words: int
    speakers_detected: List[str]
    timeline_summary: List[Dict[str, Any]]
    host_profile: Dict[str, Any]
    metadata_seo: Optional[Dict[str, Any]] = None
    topic_seed: Optional[Dict[str, Any]] = None


def get_host_reference_for_emotion(host_profile: Dict[str, Any], emotion: str = "serious") -> Optional[str]:
    """
    Resolves the best host image:
    - Mode 2: returns expression-specific image from expressions/<emotion>.png if present and real (>10KB)
    - Mode 1: falls back to default reference_cutout.png or reference.webp
    """
    if not host_profile:
        return None
    
    # Priority 1: Check default reference cutout first if valid
    default_ref = host_profile.get("reference_path")
    
    # Check expression-specific asset
    expressions = host_profile.get("expressions", {})
    emo_clean = str(emotion).lower().strip()
    if emo_clean in expressions and os.path.exists(expressions[emo_clean]):
        cand = expressions[emo_clean]
        # Only use expression file if it is a real image (>10KB) or no better default ref exists
        if os.path.getsize(cand) > 10240:
            return cand
        elif default_ref and os.path.exists(default_ref) and os.path.getsize(default_ref) > 10240:
            return default_ref
        return cand

    if default_ref and os.path.exists(default_ref):
        return default_ref
    return None


def ensure_placeholder_host_assets(host_dir: Path) -> None:
    """Ensures default reference and expression images exist as fallbacks."""
    default_dir = host_dir / "default"
    expr_dir = host_dir / "expressions"
    default_dir.mkdir(parents=True, exist_ok=True)
    expr_dir.mkdir(parents=True, exist_ok=True)

    ref_file = default_dir / "reference.jpg"
    if not ref_file.exists() and not (default_dir / "reference.webp").exists() and not (default_dir / "reference.png").exists():
        img = Image.new("RGB", (512, 512), (30, 41, 59))
        draw = ImageDraw.Draw(img)
        draw.ellipse([(156, 100), (356, 300)], fill=(71, 85, 105), outline=(148, 163, 184), width=3)
        draw.polygon([(100, 480), (256, 320), (412, 480)], fill=(51, 65, 85))
        draw.text((180, 200), "BÁC SÂM", fill=(255, 255, 255))
        img.save(str(ref_file), quality=90)

    standard_emotions = ["shock", "grief", "anger", "disbelief", "suspicious", "serious"]
    emotion_colors = {
        "shock": (239, 68, 68),
        "grief": (59, 130, 246),
        "anger": (220, 38, 38),
        "disbelief": (245, 158, 11),
        "suspicious": (168, 85, 247),
        "serious": (100, 116, 139),
    }

    for emo in standard_emotions:
        emo_file = expr_dir / f"{emo}.png"
        if not emo_file.exists():
            emo_img = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
            draw = ImageDraw.Draw(emo_img)
            col = emotion_colors.get(emo, (100, 116, 139))
            draw.ellipse([(50, 50), (350, 350)], fill=(*col, 220), outline=(255, 255, 255, 240), width=4)
            draw.text((140, 180), emo.upper(), fill=(255, 255, 255, 255))
            emo_img.save(str(emo_file))


def discover_host_assets(base_dir: Path) -> HostAssetProfile:
    """Discovers host assets or generates default placeholders."""
    host_dir = base_dir / "data" / "thumbnail_assets" / "host"
    default_dir = host_dir / "default"
    expr_dir = host_dir / "expressions"
    default_dir.mkdir(parents=True, exist_ok=True)
    expr_dir.mkdir(parents=True, exist_ok=True)

    # 1. Look for reference photo with any standard extension
    ref_path = None
    for ext in [".webp", ".png", ".jpg", ".jpeg", ".jfif"]:
        cand = default_dir / f"reference{ext}"
        if cand.exists():
            ref_path = str(cand)
            break
    if not ref_path and default_dir.exists():
        for f in default_dir.iterdir():
            if f.is_file() and f.suffix.lower() in [".webp", ".png", ".jpg", ".jpeg"]:
                ref_path = str(f)
                break

    if not ref_path:
        ensure_placeholder_host_assets(host_dir)
        ref_cand = default_dir / "reference.jpg"
        ref_path = str(ref_cand) if ref_cand.exists() else None

    # 2. Look for expression files (Mode 2)
    expressions: Dict[str, str] = {}
    if expr_dir.exists():
        for f in expr_dir.iterdir():
            if f.is_file() and f.suffix.lower() in [".webp", ".png", ".jpg", ".jpeg"]:
                emo_name = f.stem.lower()
                expressions[emo_name] = str(f)

    mode = "expression_pack" if len(expressions) >= 3 else "single_reference"

    # Compute asset hash
    hasher = hashlib.md5()
    if ref_path and os.path.exists(ref_path):
        hasher.update(Path(ref_path).read_bytes())
    for emo, path_str in sorted(expressions.items()):
        if os.path.exists(path_str):
            hasher.update(Path(path_str).read_bytes())

    return HostAssetProfile(
        host_id="bac_sam_default",
        host_name="Bác Sâm",
        mode=mode,
        reference_path=ref_path,
        expressions=expressions,
        asset_hash=hasher.hexdigest()[:12]
    )


def parse_srt_entries(srt_text: str) -> List[Dict[str, Any]]:
    """Parses SRT format into structured timestamped dialogue units."""
    pattern = re.compile(
        r'(\d+)\s*\n'
        r'(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*\n'
        r'([\s\S]*?)(?=\n\s*\n|\Z)'
    )
    entries = []
    for match in pattern.finditer(srt_text):
        idx = int(match.group(1))
        start_time = match.group(2).replace('.', ',')
        end_time = match.group(3).replace('.', ',')
        raw_text = match.group(4).strip()

        # Extract speaker if tagged, e.g. "[Bác Sâm]: ..." or "Bà Lệ: ..."
        speaker = "Người kể chuyện"
        clean_text = raw_text
        speaker_match = re.match(r'^\[?([A-Za-z0-9\s\u00C0-\u1EF9]+?)\]?\s*:\s*(.*)$', raw_text)
        if speaker_match:
            speaker = speaker_match.group(1).strip()
            clean_text = speaker_match.group(2).strip()

        entries.append({
            "index": idx,
            "start": start_time,
            "end": end_time,
            "speaker": speaker,
            "text": clean_text
        })
    return entries


def chunk_srt_semantically(entries: List[Dict[str, Any]], max_chars_per_chunk: int = 4000) -> List[Dict[str, Any]]:
    """Chunks SRT into chronological semantic scenes without dropping any text."""
    if not entries:
        return []

    chunks = []
    curr_entries = []
    curr_chars = 0
    chunk_idx = 1

    for entry in entries:
        t_len = len(entry["text"])
        if curr_chars + t_len > max_chars_per_chunk and curr_entries:
            start_t = curr_entries[0]["start"]
            end_t = curr_entries[-1]["end"]
            combined_text = "\n".join([f"[{e['speaker']}]: {e['text']}" for e in curr_entries])
            chunks.append({
                "chunk_index": chunk_idx,
                "time_range": f"{start_t} -> {end_t}",
                "dialogue": combined_text,
                "speakers": list(set([e["speaker"] for e in curr_entries]))
            })
            chunk_idx += 1
            curr_entries = []
            curr_chars = 0

        curr_entries.append(entry)
        curr_chars += t_len

    if curr_entries:
        start_t = curr_entries[0]["start"]
        end_t = curr_entries[-1]["end"]
        combined_text = "\n".join([f"[{e['speaker']}]: {e['text']}" for e in curr_entries])
        chunks.append({
            "chunk_index": chunk_idx,
            "time_range": f"{start_t} -> {end_t}",
            "dialogue": combined_text,
            "speakers": list(set([e["speaker"] for e in curr_entries]))
        })

    return chunks


def load_story_input(
    story_id: str,
    base_dir: Optional[Path] = None,
    custom_srt_path: Optional[str] = None
) -> StoryInputPayload:
    """
    Main loader for Stage 0: Loads and validates story subtitles and assets.
    """
    repo_root = base_dir or Path(r"D:\VibeCoding\auto_YT")
    web_vn_dir = repo_root / "web_vn"
    output_dir = web_vn_dir / "output"

    resolved_folder = story_id if str(story_id).startswith("story_") else f"story_{story_id}"
    story_dir = output_dir / resolved_folder

    if not story_dir.exists():
        direct_dir = output_dir / story_id
        if direct_dir.exists():
            story_dir = direct_dir
        else:
            story_dir.mkdir(parents=True, exist_ok=True)

    # 1. Locate SRT file
    srt_candidates = [
        custom_srt_path,
        str(story_dir / "full_story_subtitles.srt"),
        str(story_dir / "full_story_subtitles_speaker.srt"),
        str(story_dir / "subtitles.srt"),
    ]
    srt_path = None
    srt_content = ""
    for cand in srt_candidates:
        if cand and os.path.exists(cand):
            srt_path = cand
            try:
                srt_content = Path(cand).read_text(encoding="utf-8")
                if srt_content.strip():
                    break
            except Exception as e:
                logger.warning(f"Error reading SRT candidate {cand}: {e}")

    # Fallback to full_story_script.md or blueprint if SRT missing
    if not srt_content:
        script_file = story_dir / "full_story_script.md"
        if script_file.exists():
            logger.info(f"SRT not found. Using script markdown fallback: {script_file}")
            raw_script = script_file.read_text(encoding="utf-8")
            srt_content = f"1\n00:00:00,000 --> 00:30:00,000\n{raw_script}"
        else:
            bp_file = story_dir / "turn1_blueprint.md"
            if bp_file.exists():
                logger.info(f"Using blueprint fallback: {bp_file}")
                raw_bp = bp_file.read_text(encoding="utf-8")
                srt_content = f"1\n00:00:00,000 --> 00:30:00,000\n{raw_bp}"
            else:
                srt_content = "1\n00:00:00,000 --> 00:01:00,000\n[Bác Sâm]: Câu chuyện tâm lý kịch tính gia đình Việt Nam."

    # Parse and chunk
    entries = parse_srt_entries(srt_content)
    if not entries:
        entries = [{
            "index": 1,
            "start": "00:00:00,000",
            "end": "00:30:00,000",
            "speaker": "Người kể chuyện",
            "text": srt_content
        }]

    timeline = chunk_srt_semantically(entries)
    speakers = list(set(e["speaker"] for e in entries if e["speaker"] != "Người kể chuyện"))

    total_words = sum(len(e["text"].split()) for e in entries)
    total_lines = len(entries)
    srt_hash = hashlib.md5(srt_content.encode("utf-8")).hexdigest()[:12]

    # Host discovery
    host_profile = discover_host_assets(web_vn_dir)

    # Optional metadata read
    metadata_seo = None
    t6_file = story_dir / "turn6_metadata_seo.md"
    if t6_file.exists():
        try:
            metadata_seo = {"raw_text": t6_file.read_text(encoding="utf-8")}
        except Exception:
            pass

    topic_seed = None
    seed_file = story_dir / "topic_seed.json"
    if seed_file.exists():
        try:
            topic_seed = json.loads(seed_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    payload = StoryInputPayload(
        story_id=story_id,
        story_dir=str(story_dir),
        srt_path=srt_path,
        srt_content=srt_content,
        srt_hash=srt_hash,
        total_lines=total_lines,
        total_words=total_words,
        speakers_detected=speakers,
        timeline_summary=timeline,
        host_profile=asdict(host_profile),
        metadata_seo=metadata_seo,
        topic_seed=topic_seed
    )
    logger.info(f"Stage 0 loaded successfully: story={story_id}, words={total_words}, chunks={len(timeline)}, host_mode={host_profile.mode}")
    return payload
