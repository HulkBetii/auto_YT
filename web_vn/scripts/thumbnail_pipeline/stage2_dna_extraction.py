# -*- coding: utf-8 -*-
"""
STAGE 2: THUMBNAIL DNA EXTRACTION
- Analyzes the COMPLETE STORY to extract visual and psychological DNA
- Identifies: Victim, Aggressor, Relationship, Desire, Key Prop, High-Emotion Moment, Mystery Element, Visual Question, What NOT to reveal, Setting, Vietnamese Context
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
from .prompts import THUMBNAIL_DNA_V1, PROMPT_VERSIONS

logger = logging.getLogger("thumbnail_pipeline.stage2")


async def extract_thumbnail_dna(
    payload: StoryInputPayload,
    consistency_data: Dict[str, Any],
    engine: Optional[GeminiApiEngine] = None,
    model: str = "ag/gemini-3.8-flash-high"
) -> Dict[str, Any]:
    """
    Executes Stage 2: Extracts Thumbnail DNA from the complete story representation.
    """
    logger.info(f"Running Stage 2 Thumbnail DNA extraction for story: {payload.story_id}")
    ai_engine = engine or GeminiApiEngine(default_model=model)

    story_summary = consistency_data.get("story_summary", "")
    timeline_summary = consistency_data.get("timeline_summary", [])
    characters = consistency_data.get("characters", [])

    user_prompt = (
        f"STORY ID: {payload.story_id}\n"
        f"TÓM TẮT CÂU CHUYỆN: {story_summary}\n"
        f"DANH SÁCH NHÂN VẬT: {json.dumps(characters, ensure_ascii=False)}\n"
        f"DIỄN BIẾN THỜI GIAN: {json.dumps(timeline_summary, ensure_ascii=False)}\n\n"
        f"NỘI DUNG KỊCH BẢN GỐC (Trích đoạn cốt lõi):\n"
        f"\"\"\"\n{payload.srt_content[:20000]}\n\"\"\"\n\n"
        f"Hãy trích xuất THUMBNAIL DNA theo đúng định dạng JSON."
    )

    full_prompt = f"{THUMBNAIL_DNA_V1}\n\n{user_prompt}"

    try:
        response_text, model_used = await ai_engine.generate_content(
            prompt=full_prompt,
            model=model,
            temperature=0.3,
            max_output_tokens=2500
        )
        dna_data = extract_json_from_response(response_text)
        dna_data["model_used"] = model_used
        dna_data["prompt_version"] = PROMPT_VERSIONS["thumbnail_dna"]
        logger.info("Stage 2 DNA extraction completed successfully.")
        return dna_data
    except Exception as e:
        logger.error(f"Stage 2 DNA extraction error: {e}", exc_info=True)
        return {
            "story_core": "Mâu thuẫn gia đình gay gắt",
            "victim": {
                "description": "Người mẹ già quê nghèo khổ, lam lũ, đầy đau đớn",
                "visual_traits": "Áo nâu bạc màu, tóc bạc, gương mặt khắc khổ"
            },
            "aggressor": {
                "description": "Kẻ bất hiếu, ngạo mạn, vô ơn, hành vi tàn nhẫn",
                "visual_traits": "Quần áo sang chảnh, ánh mắt sắc lạnh trơ tráo"
            },
            "relationship": "Mẹ con trong gia đình",
            "desire": "property",
            "main_hook_type": "bóc trần sự bất hiếu",
            "high_emotion_moment": "Khoảnh khắc đối đầu cao trào nghẹn lòng",
            "key_prop": "Vật chứng bí mật gia tài",
            "mystery_element": "Bí mật đằng sau mâu thuẫn",
            "visual_question": "Sự thật nào đằng sau bi kịch gia đình này?",
            "what_not_to_reveal": ["Không lộ kết cục câu chuyện"],
            "setting": "Không gian kịch tính trong gia đình Việt",
            "vietnamese_context": ["Nét văn hóa gia đình Việt Nam"],
            "prompt_version": PROMPT_VERSIONS["thumbnail_dna"],
            "model_used": "fallback",
            "error": str(e)
        }
