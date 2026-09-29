# -*- coding: utf-8 -*-
"""Unit tests for DramaKrPipeline and speaker validation/healing logic."""

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

import pytest
from auto_yt.drama_kr_pipeline import (
    validate_speaker_tags,
    heal_speaker_tags,
    TOPIC_CLUSTERS,
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


def test_validate_speaker_tags_with_empty():
    sample_text = """
    [SPEAKER:nguoi_dan] Bắt đầu.
    [SPEAKER] Lời thoại không có id.
    [SPEAKER:nu_chinh] Đã rõ.
    """
    stats = validate_speaker_tags(sample_text)
    assert stats["total"] == 3
    assert stats["with_id"] == 2
    assert stats["empty"] == 1
    assert stats["empty_ratio"] == 0.333


def test_heal_speaker_tags():
    raw_text = """
    [SPEAKER] Lời thoại thứ nhất.
    [SPEAKER:ME_CHONG] Lời thoại thứ hai.
    [SPEAKER:nu_chinh] Lời thoại thứ ba.
    """
    healed = heal_speaker_tags(raw_text, default_role="nguoi_dan")
    assert "[SPEAKER:nguoi_dan] Lời thoại thứ nhất." in healed
    assert "[SPEAKER:me_chong] Lời thoại thứ hai." in healed
    assert "[SPEAKER:nu_chinh] Lời thoại thứ ba." in healed


def test_topic_clusters_definitions():
    assert "cluster_chaebol_con_dau" in TOPIC_CLUSTERS
    assert "cluster_tieu_tam_cong_so" in TOPIC_CLUSTERS
    assert "cluster_hoc_duong_knetizen" in TOPIC_CLUSTERS
    assert "cluster_thua_ke_gia_toc" in TOPIC_CLUSTERS

    for c_id, c_data in TOPIC_CLUSTERS.items():
        assert "name" in c_data
        assert "archetypes" in c_data
        assert "default_voice_roles" in c_data
        assert "description" in c_data
