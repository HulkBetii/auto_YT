# -*- coding: utf-8 -*-
"""Unit tests for Korean TTS and Voice Synthesis Engine."""

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
    chunk_korean_text,
    get_ffmpeg_path,
    get_ffprobe_path,
    KrTtsEngine,
    get_kr_tts_engine,
    DEFAULT_FEMALE_VOICE,
    VOICE_REFERENCE_DIR,
)


def test_chunk_korean_text_basic():
    text = (
        "안녕하세요. 제 이름은 이수진입니다. 오늘 사연을 들려드립니다. "
        "피 한 방울 섞이지 않았지만 저를 친자식처럼 키워주신 새어머니의 이야기입니다. "
        "그날 은행 창구에서 잔고 0원을 확인한 순간 저는 주저앉아 울고 말았습니다."
    )
    chunks = chunk_korean_text(text, max_chars=80)
    assert len(chunks) >= 2
    for c in chunks:
        assert len(c) <= 90
        assert len(c.strip()) > 0


def test_chunk_korean_text_strips_markdown_and_speaker_tags():
    raw = """
    # 제1막: 시작
    [SPEAKER:nguoi_dan] "출금 가능 잔액: 0원."
    [SPEAKER:nu_chinh] 저는 그 자리에 주저앉았습니다.
    """
    chunks = chunk_korean_text(raw, max_chars=100)
    joined = " ".join(chunks)
    assert "[SPEAKER:" not in joined
    assert "# 제1막" not in joined
    assert "출금 가능 잔액: 0원." in joined


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
            text="안녕하세요. 사연 시작합니다.",
            output_file=out_mp3,
            normalize_loudness=False,
        )
        assert out_mp3.exists()
        assert out_mp3.stat().st_size > 1000
        assert res["duration_seconds"] > 0
