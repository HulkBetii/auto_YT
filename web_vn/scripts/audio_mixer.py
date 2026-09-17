# -*- coding: utf-8 -*-
"""
Audio Mixer & BGM Sidechain Ducking Engine (48kHz Broadcast Standard)
Concatenates chunk WAVs with snappy conversational pacing (0.18s/0.28s),
dead silence trimming, EBU R128 loudness normalization, and audio ducking.
"""

import sys
import os
import subprocess
import json
import logging
import soundfile as sf
import numpy as np
import librosa
from pathlib import Path
from typing import List, Optional

sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("audio_mixer")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")

def create_silence_wav(duration_sec: float, output_path: Path, sample_rate: int = 48000):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-f", "lavfi", "-i",
        f"anullsrc=r={sample_rate}:cl=mono",
        "-t", str(duration_sec),
        "-c:a", "pcm_s16le",
        str(output_path)
    ]
    subprocess.run(cmd, check=True, capture_output=True)

def trim_dead_silence(input_wav: Path, output_wav: Path, top_db: float = 25, buffer_sec: float = 0.05):
    """Trims trailing/leading dead air silence with a natural acoustic buffer."""
    y, sr = sf.read(input_wav)
    trimmed_y, index = librosa.effects.trim(y, top_db=top_db)
    
    buf_samples = int(buffer_sec * sr)
    start_idx = max(0, index[0] - buf_samples)
    end_idx = min(len(y), index[1] + buf_samples)
    final_y = y[start_idx:end_idx]
    
    output_wav.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output_wav, final_y, sr)

def normalize_audio_chunk(input_wav: Path, output_wav: Path, sample_rate: int = 48000):
    """Trims dead silence and normalizes individual chunk to EBU R128 -16 LUFS."""
    temp_trimmed = output_wav.parent / f"trim_{output_wav.name}"
    trim_dead_silence(input_wav, temp_trimmed)

    cmd = [
        "ffmpeg", "-y",
        "-i", str(temp_trimmed),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar", str(sample_rate),
        "-ac", "1",
        "-c:a", "pcm_s16le",
        str(output_wav)
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    if temp_trimmed.exists():
        temp_trimmed.unlink()

def concat_audio_chunks(chunks_dir: Path, manifest_path: Path, output_wav: Path, sample_rate: int = 48000) -> Path:
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")

    lines = [json.loads(line) for line in manifest_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    temp_dir = output_wav.parent / "temp_concat"
    temp_dir.mkdir(parents=True, exist_ok=True)

    # Snappy, natural pacing micro-pauses
    silence_short = temp_dir / "silence_0.18s.wav"
    silence_change = temp_dir / "silence_0.28s.wav"
    silence_chapter = temp_dir / "silence_0.80s.wav"

    create_silence_wav(0.18, silence_short, sample_rate=sample_rate)
    create_silence_wav(0.28, silence_change, sample_rate=sample_rate)
    create_silence_wav(0.80, silence_chapter, sample_rate=sample_rate)

    concat_list_file = temp_dir / "concat_list.txt"
    with concat_list_file.open("w", encoding="utf-8") as f:
        prev_speaker = None
        prev_chapter = None

        for item in lines:
            c_id = item["id"]
            c_wav = chunks_dir / f"{c_id}.wav"
            if not c_wav.exists():
                logger.warning(f"Chunk wav missing: {c_wav}")
                continue

            curr_speaker = item.get("speaker_id")
            curr_chapter = item.get("chapter")

            if prev_chapter is not None and curr_chapter != prev_chapter:
                f.write(f"file '{silence_chapter.resolve()}'\n")
            elif prev_speaker is not None and curr_speaker != prev_speaker:
                f.write(f"file '{silence_change.resolve()}'\n")
            elif prev_speaker is not None:
                f.write(f"file '{silence_short.resolve()}'\n")

            f.write(f"file '{c_wav.resolve()}'\n")
            prev_speaker = curr_speaker
            prev_chapter = curr_chapter

    output_wav.parent.mkdir(parents=True, exist_ok=True)
    temp_raw_wav = temp_dir / "raw_concat.wav"
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_list_file),
        "-c:a", "pcm_s16le",
        str(temp_raw_wav)
    ]
    logger.info("Concatenating all speech chunks with snappy micro-pauses...")
    subprocess.run(cmd, check=True, capture_output=True)

    # Master EBU R128 normalization on narration track
    cmd_norm = [
        "ffmpeg", "-y",
        "-i", str(temp_raw_wav),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar", str(sample_rate),
        "-ac", "1",
        "-c:a", "pcm_s16le",
        str(output_wav)
    ]
    subprocess.run(cmd_norm, check=True, capture_output=True)
    logger.info(f"Clean narration track exported: {output_wav} ({output_wav.stat().st_size:,} bytes)")
    return output_wav

def mix_with_bgm(narration_wav: Path, bgm_path: Optional[Path], output_mp3: Path, bgm_volume: float = 0.12) -> Path:
    output_mp3.parent.mkdir(parents=True, exist_ok=True)

    if not bgm_path or not bgm_path.exists():
        logger.info("No BGM provided or BGM not found. Exporting speech-only MP3...")
        cmd = [
            "ffmpeg", "-y", "-i", str(narration_wav),
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-b:a", "192k",
            str(output_mp3)
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        return output_mp3

    logger.info(f"Mixing narration with BGM ({bgm_path.name}) with audio ducking...")
    # Loop BGM to match narration length and apply sidechaincompression ducking
    filter_complex = (
        f"[1:a]aloop=loop=-1:size=2e+09,volume={bgm_volume}[bgm];"
        f"[0:a][bgm]sidechaincompress=threshold=0.08:ratio=5:attack=150:release=1200[mixed];"
        f"[mixed]loudnorm=I=-16:TP=-1.5:LRA=11[normed]"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", str(narration_wav),
        "-i", str(bgm_path),
        "-filter_complex", filter_complex,
        "-map", "[normed]",
        "-c:a", "libmp3lame",
        "-b:a", "192k",
        "-shortest",
        str(output_mp3)
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    logger.info(f"Master audio story exported: {output_mp3} ({output_mp3.stat().st_size:,} bytes)")
    return output_mp3
