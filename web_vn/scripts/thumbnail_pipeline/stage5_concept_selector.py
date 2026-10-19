# -*- coding: utf-8 -*-
"""
STAGE 5: THUMBNAIL FIT SELECTION & HOST EMOTION MAPPING
- Evaluates the 3 concepts and 12 hooks via objective heuristic criteria (Thumbnail Fit Selection)
- Selects the most impactful Concept + Hook combination, factoring in Typography space & mobile clarity
- Maps the dramatic conflict to Host facial expression asset (shock, grief, anger, disbelief, suspicious, serious)
- Changing selected concept in UI does NOT require rerunning SRT/DNA analysis
"""

import sys
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from auto_yt.gemini_api_engine import GeminiApiEngine
from .stage0_load_input import StoryInputPayload
from .stage1_consistency_gate import extract_json_from_response
from .prompts import THUMBNAIL_SELECTION_V1, PROMPT_VERSIONS

logger = logging.getLogger("thumbnail_pipeline.stage5")


def map_host_expression(dna_data: Dict[str, Any], concept_type: str) -> str:
    """Heuristic fallback for mapping host expression based on story DNA."""
    concept_lower = str(concept_type).lower()
    setting_text = str(dna_data.get("setting", "")).lower()
    conflict_text = str(dna_data.get("high_emotion_moment", "")).lower()

    if "mưa" in setting_text or "nghẹn" in conflict_text or "mẹ già" in conflict_text or concept_lower == "emotional_shock":
        return "grief"
    if "bắt quả tang" in conflict_text or "lật kèo" in conflict_text or "bất ngờ" in conflict_text:
        return "shock"
    if "đuổi" in conflict_text or "hắt hủi" in conflict_text or "bất hiếu" in conflict_text or "cướp" in conflict_text:
        return "anger"
    if "bí mật" in conflict_text or "sổ đỏ" in conflict_text or concept_lower == "mystery":
        return "suspicious"
    if "phản bội" in conflict_text or "vô ơn" in conflict_text or "ngoại tình" in conflict_text:
        return "disbelief"

    return "serious"


async def select_best_concept(
    payload: StoryInputPayload,
    dna_data: Dict[str, Any],
    concepts_data: Dict[str, Any],
    hooks_data: Dict[str, Any],
    engine: Optional[GeminiApiEngine] = None,
    model: str = "ag/gemini-3.8-flash-high"
) -> Dict[str, Any]:
    """
    Executes Stage 5: Performs Thumbnail Fit Selection and maps host emotional expression.
    """
    logger.info(f"Running Stage 5 Thumbnail Fit Selection for story: {payload.story_id}")
    ai_engine = engine or GeminiApiEngine(default_model=model)

    user_prompt = (
        f"STORY ID: {payload.story_id}\n"
        f"DNA:\n{json.dumps(dna_data, ensure_ascii=False, indent=2)}\n\n"
        f"CONCEPTS:\n{json.dumps(concepts_data, ensure_ascii=False, indent=2)}\n\n"
        f"HOOKS:\n{json.dumps(hooks_data, ensure_ascii=False, indent=2)}\n\n"
        f"Hãy đánh giá Thumbnail Fit, chọn Concept tối ưu, Hook phù hợp nhất và map Host Emotion chính xác."
    )

    full_prompt = f"{THUMBNAIL_SELECTION_V1}\n\n{user_prompt}"

    try:
        response_text, model_used = await ai_engine.generate_content(
            prompt=full_prompt,
            model=model,
            temperature=0.2,
            max_output_tokens=2000
        )
        selection_data = extract_json_from_response(response_text)
        selection_data["model_used"] = model_used
        selection_data["prompt_version"] = PROMPT_VERSIONS["thumbnail_selection"]

        # Validate host emotion
        valid_emotions = ["shock", "grief", "anger", "disbelief", "suspicious", "serious"]
        if selection_data.get("host_emotion") not in valid_emotions:
            top_concept_type = concepts_data.get("concepts", [{}])[0].get("concept_type", "confrontation")
            selection_data["host_emotion"] = map_host_expression(dna_data, top_concept_type)

        # Cross-reference concept details
        cid = selection_data.get("recommended_concept_id", "A")
        matched_concept = next((c for c in concepts_data.get("concepts", []) if c.get("concept_id") == cid), {})
        selection_data.setdefault("host_position", matched_concept.get("host_position", "left"))
        selection_data.setdefault("text_zone", matched_concept.get("text_zone", "left"))
        selection_data.setdefault("text_alignment", "left")
        selection_data.setdefault("attention_marker", matched_concept.get("attention_marker", {}))

        logger.info(f"Stage 5 completed: selected_concept={selection_data.get('recommended_concept_id')}, host_emotion={selection_data.get('host_emotion')}")
        return selection_data
    except Exception as e:
        logger.error(f"Stage 5 Selection error: {e}", exc_info=True)
        concepts = concepts_data.get("concepts", [])
        top_concept = concepts[0] if concepts else {}
        hooks = hooks_data.get("hooks", [])
        top_hook = hooks[0] if hooks else {}

        return {
            "recommended_concept_id": top_concept.get("concept_id", "A"),
            "heuristic_fit_score": 90,
            "selection_rationale": "Lựa chọn mặc định theo độ kịch tính xung đột",
            "host_emotion": map_host_expression(dna_data, top_concept.get("concept_type", "confrontation")),
            "host_emotion_rationale": "Mapping cảm xúc theo cốt truyện",
            "recommended_hook_id": top_hook.get("id", "hook_s1"),
            "recommended_title_text": top_hook.get("text", "ÉP BỐ KÝ ĐẤT?"),
            "recommended_badge_text": "🎙️ SÂM KỂ CHUYỆN",
            "host_position": top_concept.get("host_position", "left"),
            "text_zone": top_concept.get("text_zone", "left"),
            "text_alignment": "left",
            "attention_marker": top_concept.get("attention_marker", {}),
            "visual_balance_notes": "Chừa khoảng trống theo concept text_zone",
            "prompt_version": PROMPT_VERSIONS["thumbnail_selection"],
            "model_used": "fallback",
            "error": str(e)
        }
