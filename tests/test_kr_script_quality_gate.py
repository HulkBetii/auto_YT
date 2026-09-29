# -*- coding: utf-8 -*-
"""Unit tests for Korean Drama script Quality Gate and Audio/Script Formatting."""

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

import pytest
from auto_yt.drama_kr_pipeline import (
    count_korean_metrics,
    extract_clean_audiobook_text,
    validate_speaker_tags,
    SIGNATURE_INTRO_CTA,
    SIGNATURE_OUTRO_CTA,
)


def test_quality_gate_length_qualification():
    short_text = "안녕하세요. 짧은 글입니다."
    short_metrics = count_korean_metrics(short_text)
    assert not short_metrics["is_length_qualified"]

    # Tạo đoạn văn đủ độ dài (~8,000 từ)
    long_paragraph = "오늘 사연은 피 한 방울 안 섞인 계모와 의붓남동생에 관한 감동적인 이야기입니다. " * 800
    long_metrics = count_korean_metrics(long_paragraph)
    assert long_metrics["is_length_qualified"]
    assert long_metrics["estimated_audio_minutes"] >= 50.0


def test_clean_audiobook_formatting_preserves_dialogues():
    sample_drama = f"""
    # 제1막: 시작
    [SPEAKER:nguoi_dan] "손님, 죄송하지만 이 계좌에는 잔액이 2만 원뿐입니다."
    {SIGNATURE_INTRO_CTA}
    [SPEAKER:nu_chinh] 저는 그 자리에 주저앉아 울고 말았습니다.
    [SPEAKER:me_chong] "네까짓 게 뭔데 우리 아들한테 그래?"
    """
    clean = extract_clean_audiobook_text(sample_drama)
    
    assert "[SPEAKER:" not in clean
    assert "# 제1막" not in clean
    assert "손님, 죄송하지만 이 계좌에는 잔액이 2만 원뿐입니다." in clean
    assert "사연 시작전 좋아요 한 번만 눌러 주세요." in clean
    assert "네까짓 게 뭔데 우리 아들한테 그래?" in clean


def test_no_forbidden_chatgpt_api_in_code():
    """Verify that no unauthorized direct OpenAI Chat API is imported."""
    with open(PROJECT_ROOT / "src" / "auto_yt" / "drama_kr_pipeline.py", "r", encoding="utf-8") as f:
        code = f.read()
    
    # Check that OpenAI client is not used
    forbidden_tokens = ["openai" + ".OpenAI", "from " + "openai import"]
    for token in forbidden_tokens:
        assert token not in code
