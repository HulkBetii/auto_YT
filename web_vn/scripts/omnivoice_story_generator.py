# -*- coding: utf-8 -*-
"""
OmniVoice Story Generator
Batch inference engine for generating audio chunks and mixing full long-form audio stories.
"""

import sys
import os
import time
import argparse
import subprocess
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("omnivoice_gen")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
SRC_SCRIPTS = REPO_ROOT / "web_vn" / "scripts"
if str(SRC_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SRC_SCRIPTS))

from audio_mixer import concat_audio_chunks, mix_with_bgm
from script_audio_parser import parse_script_to_manifest

def generate_story_audio(
    story_dir: Path,
    chapter_filter: Optional[int] = None,
    limit_chunks: Optional[int] = None,
    bgm_path: Optional[Path] = None
):
    manifest_path = story_dir / "audio_manifest.jsonl"
    script_path = story_dir / "full_story_script.md"
    audio_dir = story_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    if not manifest_path.exists():
        if not script_path.exists():
            raise FileNotFoundError(f"Story script not found at {script_path}")
        logger.info("Generating manifest from script...")
        parse_script_to_manifest(script_path, manifest_path)

    entries = [json.loads(line) for line in manifest_path.read_text(encoding="utf-8").splitlines() if line.strip()]

    if chapter_filter is not None:
        entries = [e for e in entries if e.get("chapter") == chapter_filter]
        logger.info(f"Filtered to Chapter {chapter_filter}: {len(entries)} chunks.")

    if limit_chunks is not None:
        entries = entries[:limit_chunks]
        logger.info(f"Limited to first {limit_chunks} chunks for testing.")

    total_chunks = len(entries)
    logger.info(f"Starting OmniVoice audio synthesis for {total_chunks} chunks...")

    start_time = time.time()
    generated_count = 0
    skipped_count = 0

    for idx, item in enumerate(entries, start=1):
        chunk_id = item["id"]
        speaker = item.get("speaker_id", "bac_sam")
        text = item["text"]
        ref_audio = item["ref_audio"]
        ref_text = item["ref_text"]
        speed = str(item.get("speed", 0.95))
        guidance = str(item.get("guidance_scale", 2.5))
        out_wav = audio_dir / f"{chunk_id}.wav"

        if out_wav.exists() and out_wav.stat().st_size > 1000:
            skipped_count += 1
            continue

        pct = (idx / total_chunks) * 100
        logger.info(f"[{idx}/{total_chunks}] ({pct:.1f}%) Generating {chunk_id} [{speaker}] ({len(text.split())} words)...")

        cmd = [
            "omnivoice-infer",
            "--text", text,
            "--output", str(out_wav),
            "--ref_audio", ref_audio,
            "--ref_text", ref_text,
            "--language", "vi",
            "--speed", speed,
            "--guidance_scale", guidance
        ]

        res = subprocess.run(cmd, capture_output=True, text=True)
        if not (out_wav.exists() and out_wav.stat().st_size > 1000):
            logger.error(f"Failed to generate {chunk_id}: {res.stderr}")
        else:
            generated_count += 1

    elapsed = time.time() - start_time
    logger.info(f"Synthesis finished in {elapsed:.1f}s. (Generated: {generated_count}, Reused: {skipped_count})")

    # Final Concatenation & BGM Mixing
    clean_narration_wav = audio_dir / "narration_clean.wav"
    full_mp3 = story_dir / "full_story_audio.mp3"

    logger.info("Merging audio chunks and exporting final MP3...")
    concat_audio_chunks(audio_dir, manifest_path, clean_narration_wav)
    mix_with_bgm(clean_narration_wav, bgm_path, full_mp3)

    logger.info(f"=== FULL STORY AUDIO COMPLETE: {full_mp3} ===")

def main():
    parser = argparse.ArgumentParser(description="OmniVoice Story Audio Generator")
    parser.add_argument("--story-id", type=str, default="test_01", help="Story ID to process")
    parser.add_argument("--chapter", type=int, default=None, help="Process specific chapter only")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of chunks to process")
    parser.add_argument("--bgm", type=str, default=None, help="Path to BGM audio file")
    args = parser.parse_args()

    s_dir = REPO_ROOT / "web_vn" / "output" / (f"story_{args.story_id}" if not args.story_id.startswith("story_") else args.story_id)
    bgm = Path(args.bgm) if args.bgm else None

    generate_story_audio(s_dir, chapter_filter=args.chapter, limit_chunks=args.limit, bgm_path=bgm)

if __name__ == "__main__":
    main()
