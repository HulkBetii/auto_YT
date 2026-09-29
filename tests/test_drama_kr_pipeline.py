# -*- coding: utf-8 -*-
"""Unit tests for DramaKrPipeline, Korean metrics, and speaker validation/healing logic."""

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

import pytest
from auto_yt.drama_kr_pipeline import (
    validate_speaker_tags,
    heal_speaker_tags,
    extract_clean_audiobook_text,
    count_korean_metrics,
    TOPIC_CLUSTERS,
    SIGNATURE_INTRO_CTA,
    SIGNATURE_OUTRO_CTA,
    DramaKrPipeline,
)


def test_validate_speaker_tags_standard():
    sample_text = """
    [SPEAKER:nguoi_dan] Đêm nay trăng tròn.
    [SPEAKER:me_chong] Cô dám làm vậy sao?
    [SPEAKER:nu_chinh] Tôi không còn sợ bà nữa.
    """
    stats = validate_speaker_tags(sample_text)
    assert stats["total"] == 3
    assert stats["with_id"] == 3
    assert stats["empty"] == 0
    assert stats["empty_ratio"] == 0.0
    assert not stats["has_no_tags"]


def test_validate_speaker_tags_korean_roles():
    sample_text = """
    [SPEAKER:주인공] 안녕하세요. 제 이름은 정수연입니다.
    [SPEAKER:시어머니] 네가 감히 어디서 말대꾸냐?
    [SPEAKER:nguoi_dan] 사연 시작합니다.
    """
    stats = validate_speaker_tags(sample_text)
    assert stats["total"] == 3
    assert stats["with_id"] == 3
    assert "주인공" in stats["roles"]
    assert "시어머니" in stats["roles"]


def test_heal_speaker_tags():
    raw_text = """
    [SPEAKER] 첫 번째 대사.
    [SPEAKER:ME_CHONG] 두 번째 대사.
    [SPEAKER:nu_chinh] 세 번째 대사.
    """
    healed = heal_speaker_tags(raw_text, default_role="nguoi_dan")
    assert "[SPEAKER:nguoi_dan] 첫 번째 대사." in healed
    assert "[SPEAKER:ME_CHONG] 두 번째 대사." in healed
    assert "[SPEAKER:nu_chinh] 세 번째 대사." in healed


def test_extract_clean_audiobook_text():
    raw_script = """
    # 제1막: 시작
    [SPEAKER:nguoi_dan] 안녕하세요. 오늘 사연입니다.
    [SPEAKER:nu_chinh] "엄마, 저 왔어요."
    [SPEAKER:me_ke] "우리 딸, 밥은 먹었니?"
    """
    clean = extract_clean_audiobook_text(raw_script)
    assert "[SPEAKER:" not in clean
    assert "# 제1막" not in clean
    assert "안녕하세요. 오늘 사연입니다." in clean
    assert '"엄마, 저 왔어요."' in clean


def test_count_korean_metrics():
    sample_text = "안녕하세요. 저는 36살 간호사 정수연입니다. 오늘 사연을 들려드립니다. " * 50
    metrics = count_korean_metrics(sample_text)
    assert metrics["word_count"] > 100
    assert metrics["char_count_no_space"] > 500
    assert metrics["estimated_audio_minutes"] > 0


def test_topic_clusters_definitions():
    expected_clusters = [
        "cluster_kr_stepfamily",
        "cluster_kr_gobu",
        "cluster_kr_cheating",
        "cluster_kr_dongseo",
        "cluster_kr_inheritance",
    ]
    for c_id in expected_clusters:
        assert c_id in TOPIC_CLUSTERS
        c_data = TOPIC_CLUSTERS[c_id]
        assert "name" in c_data
        assert "archetypes" in c_data
        assert "default_voice_roles" in c_data
        assert "description" in c_data
        assert "sample_titles" in c_data
        assert len(c_data["sample_titles"]) >= 3


def test_signature_ctas():
    assert "사연 시작전 좋아요" in SIGNATURE_INTRO_CTA
    assert "구독과 좋아요" in SIGNATURE_OUTRO_CTA
    assert "카카오톡" in SIGNATURE_OUTRO_CTA
