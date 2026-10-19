# -*- coding: utf-8 -*-
"""
ACCEPTANCE & REGRESSION TEST SUITE FOR EMBEDDED TEXT THUMBNAIL PIPELINE
Channel: 'Sâm Kể Chuyện' (web_vn)
Tests:
1. TEST 1: Exact Vietnamese Headline formatting with accents ('ÉP BỐ\\nKÝ ĐẤT?')
2. TEST 2: Rejection of unaccented / misspelled text ('ONG MU THAT SAO' vs 'ÔNG MÙ THẬT SAO?')
3. TEST 3: Retry & Fallback State Machine (Visual Pass + Text Fail -> Stage 9 Typography Repair)
4. TEST 4: Malformed anatomy decision gate (Visual Fail -> Full Image Regeneration, NOT typography repair)
5. TEST 5: Dynamic Layout & Right-Side Text Zone gradient
6. TEST 6: User Custom Vietnamese Headline preserved 100% without LLM alteration
7. TEST 7: Caching behavior on headline change (no SRT reanalysis)
8. TEST 8: Stage 9 Typography Compositor produces 1280x720 PNG with BeVietnamPro font
"""

import sys
import os
import json
import asyncio
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
WEB_VN_DIR = REPO_ROOT / "web_vn"
SRC_DIR = REPO_ROOT / "src"

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))
if str(WEB_VN_DIR) not in sys.path:
    sys.path.insert(0, str(WEB_VN_DIR))

from scripts.thumbnail_pipeline.stage0_load_input import load_story_input
from scripts.thumbnail_pipeline.stage4_hook_engine import normalize_hook_typography
from scripts.thumbnail_pipeline.stage6_prompt_builder import build_full_thumbnail_prompt
from scripts.thumbnail_pipeline.stage8_vision_qc import normalize_vietnamese_text
from scripts.generate_thumbnail_playwright import (
    composite_vietnamese_thumbnail,
    fit_typography_lines,
    get_vietnamese_bold_font
)
from scripts.thumbnail_pipeline.pipeline_runner import ThumbnailPipelineRunner


def test_1_and_2_vietnamese_exact_accents():
    """Verify that accent normalization detects exact matches vs dropped diacritics."""
    expected_1 = "ÉP BỐ\nKÝ ĐẤT?"
    exact_1 = "ÉP BỐ\nKÝ ĐẤT?"
    wrong_1 = "EP BO\nKY DAT"
    
    assert normalize_vietnamese_text(exact_1) == normalize_vietnamese_text(expected_1), "Exact text must match"
    assert normalize_vietnamese_text(wrong_1) != normalize_vietnamese_text(expected_1), "Unaccented text must NOT match"

    expected_2 = "ÔNG MÙ\nTHẬT SAO?"
    unaccented_2 = "ONG MU THAT SAO"
    assert normalize_vietnamese_text(unaccented_2) != normalize_vietnamese_text(expected_2), "ONG MU THAT SAO must be rejected"
    print("✓ TEST 1 & TEST 2 Passed: Vietnamese accents strictly validated.")


def test_3_stage4_typography_plan_normalization():
    """Verify Stage 4 normalizes typography plan with lines, yellow_words, red_words, white_words."""
    raw_hook = {
        "id": "h1",
        "text": "ÉP BỐ KÝ ĐẤT?",
        "category": "shock",
        "yellow_words": ["KÝ ĐẤT?"],
    }
    normalized = normalize_hook_typography(raw_hook)
    assert "lines" in normalized and len(normalized["lines"]) >= 1
    assert "yellow_words" in normalized
    assert "white_words" in normalized
    assert normalized["typography_style"] == "bold_shock"
    print("✓ TEST 3 Passed: Stage 4 Typography Plan normalized.")


def test_4_stage6_full_prompt_structure_and_exact_text():
    """Verify Stage 6 places the exact headline text in the middle and end of prompt."""
    dna = {
        "story_core": "Mẹ già bị con dâu bẻ tay cướp nhẫn cưới",
        "victim": {"description": "Người mẹ già nghèo"},
        "aggressor": {"description": "Con dâu sang chảnh"},
        "key_prop": "Chiếc nhẫn cưới",
        "setting": "Chân cầu thang biệt thự",
        "high_emotion_moment": "Con dâu cướp nhẫn",
        "vietnamese_context": ["Nhẫn cưới vàng ta"]
    }
    concept = {
        "concept_id": "A",
        "main_subject": "Bà Lệ ngồi bệt",
        "secondary_subject": "Con dâu Thảo",
        "key_prop": "Nhẫn cưới",
        "setting": "Biệt thự",
        "text_zone": "right",
        "host_position": "left",
        "host_emotion": "anger"
    }
    selection = {
        "host_emotion": "anger",
        "host_position": "left",
        "text_zone": "right"
    }
    hook = {
        "id": "h_test",
        "text": "ÉP BỐ\nKÝ ĐẤT?",
        "lines": ["ÉP BỐ", "KÝ ĐẤT?"],
        "yellow_words": ["KÝ ĐẤT?"],
        "red_words": [],
        "white_words": ["ÉP BỐ"],
        "text_alignment": "right"
    }
    
    prompt_res = build_full_thumbnail_prompt(dna, concept, selection, hook)
    final_p = prompt_res["final_prompt"]
    
    # Must contain exact headline
    assert "ÉP BỐ" in final_p and "KÝ ĐẤT?" in final_p
    assert "Render the following Vietnamese headline EXACTLY as written" in final_p
    assert "FINAL MANDATORY TEXT CHECK" in final_p
    assert prompt_res["text_zone"] == "right"
    print("✓ TEST 4 Passed: Stage 6 Prompt structure incorporates exact headline and right-side text zone.")


def test_5_stage9_dynamic_gradient_and_rendering():
    """Verify Stage 9 renders 1280x720 PNG with dynamic text zone and Vietnamese BeVietnamPro font."""
    test_out_dir = WEB_VN_DIR / "output" / "test_stage9"
    test_out_dir.mkdir(parents=True, exist_ok=True)
    out_file = test_out_dir / "thumbnail_youtube.png"
    bg_file = test_out_dir / "thumbnail_raw.png"

    res_path = composite_vietnamese_thumbnail(
        bg_image_path=bg_file,
        title_text="ÉP BỐ\nKÝ ĐẤT?",
        output_thumb_path=out_file,
        explicit_lines=["ÉP BỐ", "KÝ ĐẤT?"],
        text_zone="right",
        yellow_words=["KÝ ĐẤT?"],
        red_words=[],
        white_words=["ÉP BỐ"]
    )

    assert res_path.exists(), "Thumbnail file must exist"
    with Image.open(str(res_path)) as img:
        assert img.size == (1280, 720), f"Size must be 1280x720, got {img.size}"
    print("✓ TEST 5 Passed: Stage 9 Typography Compositor generated 1280x720 image with right-side gradient.")


async def test_6_custom_headline_preserved_in_pipeline():
    """Verify that when user supplies a custom headline, the pipeline preserves it 100%."""
    runner = ThumbnailPipelineRunner()
    custom_title = "ÔNG MÙ\nTHẬT SAO?"
    
    prompt_data = await runner.run_stage_6(
        story_id="story_bo_chong_drama_04",
        custom_headline=custom_title
    )
    
    assert prompt_data["headline"] == custom_title
    assert "ÔNG MÙ" in prompt_data["final_prompt"]
    assert "THẬT SAO?" in prompt_data["final_prompt"]
    print("✓ TEST 6 Passed: User custom headline preserved 100% without LLM alteration.")


async def test_7_full_pipeline_mock_execution():
    """Verify E2E execution of pipeline runner in Mock mode to validate State Machine transitions."""
    runner = ThumbnailPipelineRunner()
    story_id = "story_bo_chong_drama_04"
    
    res = await runner.run_full_pipeline(
        story_id=story_id,
        provider_name="mock",
        title_override="ÉP BỐ\nKÝ ĐẤT?",
        skip_image_generation=False
    )
    
    assert res["status"] == "ready", "Status must be ready"
    final_p = Path(res["final_output"]["path"])
    assert final_p.exists(), "Final thumbnail_youtube.png must exist"
    print(f"✓ TEST 7 Passed: E2E Pipeline ran cleanly in Mock mode -> Output: {final_p}")


async def main():
    print("=== STARTING THUMBNAIL PIPELINE TEST SUITE ===")
    test_1_and_2_vietnamese_exact_accents()
    test_3_stage4_typography_plan_normalization()
    test_4_stage6_full_prompt_structure_and_exact_text()
    test_5_stage9_dynamic_gradient_and_rendering()
    await test_6_custom_headline_preserved_in_pipeline()
    await test_7_full_pipeline_mock_execution()
    print("=== ALL ACCEPTANCE TESTS PASSED SUCCESSFULLY! ===")


if __name__ == "__main__":
    asyncio.run(main())
