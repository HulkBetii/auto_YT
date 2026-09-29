# -*- coding: utf-8 -*-
"""Unit tests for 4D K-Drama Topic Matrix and Topic Registry."""

import os
import sys
import json
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

import pytest
from auto_yt.kr_topic_matrix import (
    KrTopicMatrix,
    KrTopicRegistry,
    RELATIONSHIPS,
    CATALYSTS,
    REVERSALS,
    EMOTIONAL_TONES,
)


def test_matrix_dimensions():
    """Verify exact count of each axis."""
    assert len(RELATIONSHIPS) == 8
    assert len(CATALYSTS) == 6
    assert len(REVERSALS) == 5
    assert len(EMOTIONAL_TONES) == 3

    total_space = len(RELATIONSHIPS) * len(CATALYSTS) * len(REVERSALS) * len(EMOTIONAL_TONES)
    assert total_space == 720


def test_all_720_combos_generation_and_uniqueness():
    """Verify that all 720 combinations are generated with 100% unique hashes."""
    combos = KrTopicMatrix.get_all_combos()
    assert len(combos) == 720

    hashes = [c["combo_hash"] for c in combos]
    unique_hashes = set(hashes)
    assert len(unique_hashes) == 720, "Every combo must have a unique hash"

    for h in hashes:
        assert len(h) == 16


def test_build_combo_seed_structure():
    """Verify that build_combo_seed produces full Korean structured data."""
    seed = KrTopicMatrix.build_combo_seed(
        rel_id="rel_stepfamily",
        cat_id="cat_financial_heist",
        rev_id="rev_hidden_vault",
        tone_id="tone_tears",
        custom_note="Test note",
    )
    assert seed["combo_hash"] == KrTopicMatrix.calculate_combo_hash("rel_stepfamily", "cat_financial_heist", "rev_hidden_vault", "tone_tears")
    assert "계모" in seed["summary"]
    assert "통장" in seed["summary"]
    assert "roles" in seed
    assert len(seed["keywords"]) > 0


def test_topic_registry_persistence_and_deduplication():
    """Verify Topic Registry file persistence and deduplication."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        reg_file = Path(tmp_dir) / "test_kr_topic_registry.json"
        registry = KrTopicRegistry(registry_path=reg_file)

        # Initial state
        cov = registry.get_matrix_coverage()
        assert cov["total_space"] == 720
        assert cov["used_count"] == 0
        assert cov["remaining_count"] == 720

        # Get fresh combo
        combo1 = registry.get_next_fresh_combo()
        assert combo1["combo_hash"] not in registry.get_used_hashes()

        # Register story
        registry.register_completed_story(combo1["combo_hash"], {
            "slug": "test_story_1",
            "rel_name": combo1["rel_name"],
            "cat_name": combo1["cat_name"],
            "rev_name": combo1["rev_name"],
            "tone_name": combo1["tone_name"],
            "metrics": {"word_count": 8000, "estimated_audio_minutes": 75.0},
        })

        # Check coverage updated
        cov2 = registry.get_matrix_coverage()
        assert cov2["used_count"] == 1
        assert cov2["remaining_count"] == 719
        assert combo1["combo_hash"] in registry.get_used_hashes()

        # Next fresh combo should NOT be combo1
        combo2 = registry.get_next_fresh_combo()
        assert combo2["combo_hash"] != combo1["combo_hash"]


def test_registry_filtered_combo():
    """Verify that filtering by specific axis works correctly."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        reg_file = Path(tmp_dir) / "test_kr_topic_registry.json"
        registry = KrTopicRegistry(registry_path=reg_file)

        combo = registry.get_next_fresh_combo(
            filter_rel="rel_gobu",
            filter_tone="tone_cider",
        )
        assert combo["rel_id"] == "rel_gobu"
        assert combo["tone_id"] == "tone_cider"
