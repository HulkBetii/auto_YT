# -*- coding: utf-8 -*-
"""
Story Audio Generator (VieNeu-TTS v3 Turbo 48kHz & OmniVoice Hybrid Engine)
High-performance batch inference engine with GPU caching, resume-on-disk,
dead silence trimming, snappy conversational pauses (0.18s/0.28s),
EBU R128 loudness normalization, and broadcast master mixing.
"""

import sys
import os
import re
import time
import argparse
import subprocess
import json
import logging
import soundfile as sf
import numpy as np
from pathlib import Path
from typing import Dict, Any, List, Optional

sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("story_audio_gen")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
SRC_SCRIPTS = REPO_ROOT / "web_vn" / "scripts"
if str(SRC_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SRC_SCRIPTS))

from audio_mixer import concat_audio_chunks, mix_with_bgm, normalize_audio_chunk, get_ffmpeg_bin
from script_audio_parser import parse_script_to_manifest

# Global VieNeu-TTS model cache
_VIENEU_MODEL = None

def get_vieneu_model():
    global _VIENEU_MODEL
    if _VIENEU_MODEL is None:
        logger.info("Initializing VieNeu-TTS v3 Turbo (48kHz) in GPU memory...")
        from vieneu import Vieneu
        _VIENEU_MODEL = Vieneu()
        logger.info("VieNeu-TTS v3 Turbo ready.")
    return _VIENEU_MODEL

def generate_story_audio(
    story_dir: Path,
    engine: str = "vieneu",
    chapter_filter: Optional[int] = None,
    limit_chunks: Optional[int] = None,
    bgm_path: Optional[Path] = None
):
    manifest_path = story_dir / "audio_manifest.jsonl"
    script_path = story_dir / "full_story_script.md"
    audio_dir = story_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    norm_audio_dir = story_dir / "norm_audio"
    norm_audio_dir.mkdir(parents=True, exist_ok=True)

    # Re-generate manifest if needed or if missing
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
    logger.info(f"Starting Story Audio Synthesis using [{engine.upper()}] engine for {total_chunks} chunks...")

    vieneu_tts = None
    if engine.lower() == "vieneu":
        vieneu_tts = get_vieneu_model()

    start_time = time.time()
    generated_count = 0
    skipped_count = 0

    for idx, item in enumerate(entries, start=1):
        chunk_id = item["id"]
        speaker = item.get("speaker_id", "bac_sam")
        text = item["text"]
        out_wav = audio_dir / f"{chunk_id}.wav"
        norm_wav = norm_audio_dir / f"{chunk_id}.wav"

        # Resume-on-disk checkpoint
        if norm_wav.exists() and norm_wav.stat().st_size > 1000:
            skipped_count += 1
            continue

        pct = (idx / total_chunks) * 100
        words_count = len(text.split())
        logger.info(f"[{idx}/{total_chunks}] ({pct:.1f}%) Generating {chunk_id} [{speaker}] ({words_count} words)...")

        t0 = time.time()
        
        clean_text = re.sub(r"\[.*?\]", "", text).strip()
        if not clean_text:
            continue

        if engine.lower() == "vieneu":
            ref_audio = item.get("ref_audio")
            voice = item.get("voice")
            style = item.get("style", "doc_truyen" if "sam" in speaker.lower() else "tu_nhien")
            temperature = float(item.get("temperature", 0.82))
            top_p = float(item.get("top_p", 0.95))
            top_k = int(item.get("top_k", 25))
            use_ref_codes = bool(item.get("use_ref_codes", True))
            silence_p = float(item.get("silence_p", 0.15))
            repetition_penalty = float(item.get("repetition_penalty", 1.2))

            if ref_audio and not os.path.exists(ref_audio):
                candidate = REPO_ROOT / "web_vn" / "voices" / Path(ref_audio).name
                if candidate.exists():
                    ref_audio = str(candidate)

            infer_kwargs = dict(
                style=style, temperature=temperature, top_p=top_p, top_k=top_k,
                silence_p=silence_p, repetition_penalty=repetition_penalty,
            )
            if ref_audio and os.path.exists(ref_audio):
                audio_arr = vieneu_tts.infer(clean_text, ref_audio=ref_audio, use_ref_codes=use_ref_codes, denoise=True, **infer_kwargs)
            elif voice:
                audio_arr = vieneu_tts.infer(clean_text, voice=voice, use_ref_codes=use_ref_codes, **infer_kwargs)
            else:
                audio_arr = vieneu_tts.infer(clean_text, **infer_kwargs)

            sf.write(out_wav, audio_arr, vieneu_tts.sample_rate)
        elif engine.lower() == "edge_tts":
            import edge_tts
            import asyncio
            raw_text = re.sub(r"\[.*?\]", "", text).strip()
            edge_voice = item.get("edge_voice", "vi-VN-NamMinhNeural" if "sam" in speaker.lower() or "chong" in speaker.lower() else "vi-VN-HoaiMyNeural")
            edge_rate = item.get("edge_rate", "+0%")
            edge_pitch = item.get("edge_pitch", "+0Hz")
            
            temp_edge_mp3 = story_dir / f"temp_{chunk_id}.mp3"
            async def run_edge():
                comm = edge_tts.Communicate(raw_text, edge_voice, rate=edge_rate, pitch=edge_pitch)
                await comm.save(str(temp_edge_mp3))
            asyncio.run(run_edge())
            
            # Convert to wav
            cmd_conv = [get_ffmpeg_bin(), "-y", "-i", str(temp_edge_mp3), "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", str(out_wav)]
            subprocess.run(cmd_conv, check=True, capture_output=True)
            if temp_edge_mp3.exists():
                temp_edge_mp3.unlink()
        else:
            # OmniVoice fallback
            ref_audio = item["ref_audio"]
            ref_text = item["ref_text"]
            speed = str(item.get("speed", 0.95))
            guidance = str(item.get("guidance_scale", 2.2))
            cmd = [
                "omnivoice-infer",
                "--text", text,
                "--output", str(out_wav),
                "--ref_audio", ref_audio,
                "--ref_text", ref_text,
                "--language", "vi",
                "--speed", speed,
                "--guidance_scale", guidance,
                "--num_step", "50"
            ]
            subprocess.run(cmd, check=True, capture_output=True)

        # Normalize loudness & trim dead air to EBU R128 (-16 LUFS)
        normalize_audio_chunk(out_wav, norm_wav, sample_rate=48000 if engine.lower() in ["vieneu", "edge_tts"] else 24000)
        dt = time.time() - t0
        generated_count += 1

        # Periodic GPU VRAM cleanup for long-running batches (1h-1h30 scripts)
        if idx % 10 == 0:
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

    elapsed = time.time() - start_time
    logger.info(f"Synthesis completed in {elapsed:.1f}s. (Generated: {generated_count}, Reused: {skipped_count})")

    # Concatenation & Master BGM Mixing
    clean_narration_wav = story_dir / "narration_clean.wav"
    full_mp3 = story_dir / "full_story_audio.mp3"

    logger.info("Merging audio chunks and exporting master MP3 with dramatic pacing...")
    concat_audio_chunks(norm_audio_dir, manifest_path, clean_narration_wav, sample_rate=48000 if engine.lower() in ["vieneu", "edge_tts"] else 24000, chapter_filter=chapter_filter)
    mix_with_bgm(clean_narration_wav, bgm_path, full_mp3)

    logger.info(f"=== FULL STORY AUDIO COMPLETE: {full_mp3} ({full_mp3.stat().st_size:,} bytes) ===")
    return full_mp3

def main():
    parser = argparse.ArgumentParser(description="Story Audio Generator")
    parser.add_argument("--story-id", type=str, default="test_01", help="Story ID to process")
    parser.add_argument("--engine", type=str, default="vieneu", choices=["vieneu", "edge_tts", "omnivoice"], help="TTS engine")
    parser.add_argument("--chapter", type=int, default=None, help="Process specific chapter only")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of chunks to process")
    parser.add_argument("--bgm", type=str, default=None, help="Path to BGM audio file")
    args = parser.parse_args()

    s_dir = REPO_ROOT / "web_vn" / "output" / (f"story_{args.story_id}" if not args.story_id.startswith("story_") else args.story_id)
    bgm = Path(args.bgm) if args.bgm else None

    generate_story_audio(s_dir, engine=args.engine, chapter_filter=args.chapter, limit_chunks=args.limit, bgm_path=bgm)

if __name__ == "__main__":
    main()
