# -*- coding: utf-8 -*-
"""
STAGE 3: THREE DISTINCT VISUAL CONCEPTS GENERATOR
- Generates 3 substantially different thumbnail directions:
  * Concept A: CONFRONTATION (pressure, argument, eviction, forced signature)
  * Concept B: MYSTERY / EVIDENCE (suspicious object, unexplained clue, hidden relationship)
  * Concept C: EMOTIONAL SHOCK (victim humiliation, grief, desperation, disbelief)
- Enforces strict character limit: Host + max 2 story characters (3 only if strictly needed)
- Provides dynamic layout metadata: text_zone, host_position, host_gaze_direction, attention_marker
"""

import sys
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from auto_yt.gemini_api_engine import GeminiApiEngine
from .stage0_load_input import StoryInputPayload
from .stage1_consistency_gate import extract_json_from_response
from .prompts import THUMBNAIL_CONCEPTS_V1, PROMPT_VERSIONS

logger = logging.getLogger("thumbnail_pipeline.stage3")


async def generate_3_concepts(
    payload: StoryInputPayload,
    dna_data: Dict[str, Any],
    engine: Optional[GeminiApiEngine] = None,
    model: str = "ag/gemini-3.8-flash-high"
) -> Dict[str, Any]:
    """
    Executes Stage 3: Generates 3 distinct thumbnail concepts (A, B, C) with dynamic layout metadata.
    """
    logger.info(f"Running Stage 3 Concept Generation for story: {payload.story_id}")
    ai_engine = engine or GeminiApiEngine(default_model=model)

    user_prompt = (
        f"STORY ID: {payload.story_id}\n"
        f"THUMBNAIL DNA:\n"
        f"- Story Core: {dna_data.get('story_core')}\n"
        f"- Victim: {json.dumps(dna_data.get('victim', {}), ensure_ascii=False)}\n"
        f"- Aggressor: {json.dumps(dna_data.get('aggressor', {}), ensure_ascii=False)}\n"
        f"- Relationship: {dna_data.get('relationship')}\n"
        f"- Desire: {dna_data.get('desire')}\n"
        f"- Key Prop: {dna_data.get('key_prop')}\n"
        f"- High-Emotion Moment: {dna_data.get('high_emotion_moment')}\n"
        f"- Mystery Element: {dna_data.get('mystery_element')}\n"
        f"- Visual Question: {dna_data.get('visual_question')}\n"
        f"- Setting: {dna_data.get('setting')}\n"
        f"- What NOT to reveal: {json.dumps(dna_data.get('what_not_to_reveal', []), ensure_ascii=False)}\n\n"
        f"Hãy sinh đúng 3 Concept (A: Đối đầu, B: Bí ẩn/Vật chứng, C: Đau thương sụp đổ) theo đúng cấu trúc JSON."
    )

    full_prompt = f"{THUMBNAIL_CONCEPTS_V1}\n\n{user_prompt}"

    try:
        response_text, model_used = await ai_engine.generate_content(
            prompt=full_prompt,
            model=model,
            temperature=0.4,
            max_output_tokens=3000
        )
        concepts_data = extract_json_from_response(response_text)
        concepts_data["model_used"] = model_used
        concepts_data["prompt_version"] = PROMPT_VERSIONS["thumbnail_concepts"]
        logger.info(f"Stage 3 completed: generated {len(concepts_data.get('concepts', []))} concepts.")
        return concepts_data
    except Exception as e:
        logger.error(f"Stage 3 Concept generation error: {e}", exc_info=True)
        # Safe fallback concepts
        return {
            "concepts": [
                {
                    "concept_id": "A",
                    "concept_type": "confrontation",
                    "concept_name": "Đối đầu trực diện",
                    "story_moment": "Khoảnh khắc tranh cãi gay gắt và đối đầu quyền lợi",
                    "visual_question": "Vì sao con cái lại đối xử tệ bạc với mẹ già?",
                    "main_subject": "Nạn nhân chịu uất ức",
                    "secondary_subject": "Kẻ phản diện ngạo mạn xua đuổi",
                    "optional_supporting_subject": None,
                    "key_prop": str(dna_data.get("key_prop", "Vật chứng mâu thuẫn")),
                    "setting": str(dna_data.get("setting", "Không gian gia đình")),
                    "host_emotion": "anger",
                    "host_position": "left",
                    "host_gaze_direction": "Nhìn sang phải với ánh mắt phẫn nộ",
                    "text_zone": "left",
                    "suggested_hook": "ĐUỔI MẸ RA ĐƯỜNG – C.HẾT LẶNG TẠI TRẬN",
                    "attention_marker": {"enabled": False, "type": "none", "target": None},
                    "what_is_hidden": "Không lộ kết cục câu chuyện"
                },
                {
                    "concept_id": "B",
                    "concept_type": "mystery",
                    "concept_name": "Bí ẩn vật chứng",
                    "story_moment": "Cận cảnh hé lộ vật chứng bí mật trong bóng tối",
                    "visual_question": "Bí mật gì ẩn sau vật chứng chấn động?",
                    "main_subject": "Bàn tay cầm vật chứng bí mật",
                    "secondary_subject": "Gương mặt kẻ phản diện sững sờ",
                    "optional_supporting_subject": None,
                    "key_prop": str(dna_data.get("key_prop", "Tờ giấy di chúc")),
                    "setting": "Góc phòng tối với spotlight kịch tính",
                    "host_emotion": "suspicious",
                    "host_position": "right",
                    "host_gaze_direction": "Nhìn sang trái với vẻ nghi ngờ",
                    "text_zone": "left",
                    "suggested_hook": "VỪA MỞ TỜ GIẤY – SỰ THẬT CHẤN ĐỘNG?",
                    "attention_marker": {"enabled": True, "type": "arrow", "target": "Vật chứng"},
                    "what_is_hidden": "Không lộ bí mật gia tài"
                },
                {
                    "concept_id": "C",
                    "concept_type": "emotional_shock",
                    "concept_name": "Nỗi đau sụp đổ",
                    "story_moment": "Người mẹ già nghẹn ngào quỵ ngã trong uất ức",
                    "visual_question": "Nỗi đau nào khiến mẹ già nghẹn ngào câm lặng?",
                    "main_subject": "Mẹ già ôm ngực đau đớn ngấn lệ",
                    "secondary_subject": "Bóng lưng con cái vô tình",
                    "optional_supporting_subject": None,
                    "key_prop": "Kỷ vật gia đình cũ kỹ",
                    "setting": "Góc tối u buồn",
                    "host_emotion": "grief",
                    "host_position": "left",
                    "host_gaze_direction": "Nhìn thẳng vào người xem đầy xót xa",
                    "text_zone": "left",
                    "suggested_hook": "MẸ GIÀ NGHẸN NGÀO – CON VÔ ƠN BẠC NGHĨA",
                    "attention_marker": {"enabled": False, "type": "none", "target": None},
                    "what_is_hidden": "Không lộ kết cục"
                }
            ],
            "prompt_version": PROMPT_VERSIONS["thumbnail_concepts"],
            "model_used": "fallback",
            "error": str(e)
        }
