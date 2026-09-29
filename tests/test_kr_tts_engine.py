# -*- coding: utf-8 -*-
"""Unit tests for Korean TTS, Text Sanitizer, and Broadcast-Grade Voice Engine."""

import os
import sys
import json
import asyncio
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

import pytest
from auto_yt.kr_tts_engine import (
    sanitize_korean_script_for_tts,
    generate_silence_wav,
    chunk_korean_text,
    get_ffmpeg_path,
    get_ffprobe_path,
    KrTtsEngine,
    get_kr_tts_engine,
    DEFAULT_FEMALE_VOICE,
    VOICE_REFERENCE_DIR,
)


def test_sanitize_korean_script_for_tts():
    raw_script = """
    # 제1막: 시작
    [SPEAKER:nguoi_dan] "출금 가능 잔액: 0원."
    ***
    [OO백화점 압구정점: 한정판 에르메스 버킨백 외 3,180만 원 결제]
    ---
    [SPEAKER:nu_chinh] **저는** 10년 동안 모은 2억 1,400만 원을 확인했습니다.
    - 배신당한 기분이었죠.
    """
    cleaned = sanitize_korean_script_for_tts(raw_script)
    
    assert "[SPEAKER:" not in cleaned
    assert "# 제1막" not in cleaned
    assert "***" not in cleaned
    assert "---" not in cleaned
    assert "[" not in cleaned
    assert "]" not in cleaned
    assert "3180만 원" in cleaned, "Commas in Korean currency should be normalized"
    assert "2억 1400만 원" in cleaned
    assert "**" not in cleaned
    assert "저는" in cleaned
    assert "OO백화점 압구정점: 한정판 에르메스 버킨백 외 3180만 원 결제" in cleaned


def test_generate_silence_wav():
    with tempfile.TemporaryDirectory() as tmp_dir:
        silence_file = Path(tmp_dir) / "silence_test.wav"
        generate_silence_wav(silence_file, duration_s=0.35, sample_rate=32000)
        assert silence_file.exists()
        # 0.35s * 32000 samples/s * 2 bytes/sample = 22400 bytes + 44 bytes header
        assert silence_file.stat().st_size >= 22444


def test_chunk_korean_text_with_paragraph_end_flag():
    text = (
        "첫 번째 문단입니다. 사연을 들려드립니다.\n\n"
        "두 번째 문단입니다. 새어머니의 이야기입니다."
    )
    chunks = chunk_korean_text(text, max_chars=100)
    assert len(chunks) == 2
    assert chunks[0][1] is True, "First chunk should be paragraph end"
    assert chunks[1][1] is True, "Second chunk should be paragraph end"


def test_ffmpeg_and_ffprobe_paths_detected():
    ffmpeg = get_ffmpeg_path()
    ffprobe = get_ffprobe_path()
    assert ffmpeg is not None and len(ffmpeg) > 0
    assert ffprobe is not None and len(ffprobe) > 0


def test_voice_reference_profile_and_samples():
    profile_path = VOICE_REFERENCE_DIR / "voice_profile_kr_female_1.json"
    assert profile_path.exists(), "voice_profile_kr_female_1.json must exist"

    data = json.loads(profile_path.read_text(encoding="utf-8"))
    assert data["profile_id"] == "kr_female_sayeon_mannam_01"
    assert "reference_samples" in data
    assert "candidate_b_recommended" in data["reference_samples"]

    sample_b_name = data["reference_samples"]["candidate_b_recommended"]["audio_file"]
    sample_b_path = VOICE_REFERENCE_DIR / sample_b_name
    assert sample_b_path.exists(), f"Sample file {sample_b_path} must exist"


@pytest.mark.asyncio
async def test_synthesize_short_text_edge_tts():
    engine = KrTtsEngine(default_voice=DEFAULT_FEMALE_VOICE)
    with tempfile.TemporaryDirectory() as tmp_dir:
        out_mp3 = Path(tmp_dir) / "test_synth.mp3"
        res = await engine.synthesize_text(
            text="안녕하세요. 사연 시작합니다. 3,180만 원 결제되었습니다.",
            output_file=out_mp3,
            normalize_loudness=False,
        )
        assert out_mp3.exists()
        assert out_mp3.stat().st_size > 1000
        assert res["duration_seconds"] > 0
