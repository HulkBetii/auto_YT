# -*- coding: utf-8 -*-
"""
STAGE 4: VIETNAMESE TEXT HOOK ENGINE & TYPOGRAPHY PLAN
- Generates 12+ punchy, high-CTR Vietnamese hooks (at least 4 Mystery, 4 Shock, 4 Emotional)
- Enforces 3-8 words per hook for mobile feed readability
- Enforces structured Typography Plan: lines (2-4 lines), primary_keywords, yellow_words, red_words, white_words, style, alignment, text_zone
- Applies 5 proven dramatic frameworks (Action+Question, Object+Mystery, Person+Secret, Pre-Reveal, Unexpected Detail)
- Tags color semantics: Yellow for core keywords/wealth/truth, Red for shock/crime/betrayal, White for baseline
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
from .prompts import THUMBNAIL_HOOKS_V1, PROMPT_VERSIONS

logger = logging.getLogger("thumbnail_pipeline.stage4")


def normalize_hook_typography(hook: Dict[str, Any]) -> Dict[str, Any]:
    """Ensures a hook has all mandatory typography plan fields populated."""
    text = hook.get("text", "").strip()
    lines = hook.get("lines") or []
    if not lines and text:
        # Fallback line splitter if LLM didn't return lines
        if " – " in text:
            lines = [s.strip() for s in text.split(" – ") if s.strip()]
        elif " - " in text:
            lines = [s.strip() for s in text.split(" - ") if s.strip()]
        elif ":" in text:
            lines = [s.strip() for s in text.split(":") if s.strip()]
        else:
            words = text.split()
            mid = max(1, len(words) // 2)
            lines = [" ".join(words[:mid]), " ".join(words[mid:])] if len(words) > 3 else [text]

    hook["lines"] = lines
    hook.setdefault("primary_keywords", hook.get("yellow_words") or [])
    hook.setdefault("yellow_words", [])
    hook.setdefault("red_words", [])
    hook.setdefault("white_words", [l for l in lines if l not in hook.get("yellow_words", []) and l not in hook.get("red_words", [])])
    hook.setdefault("typography_style", "bold_shock" if hook.get("category") == "shock" else "mystery")
    hook.setdefault("text_alignment", "left")
    hook.setdefault("preferred_text_zone", "left")
    hook.setdefault("hidden_information", "")
    return hook


async def generate_vietnamese_hooks(
    payload: StoryInputPayload,
    dna_data: Dict[str, Any],
    engine: Optional[GeminiApiEngine] = None,
    model: str = "ag/gemini-3.8-flash-high"
) -> Dict[str, Any]:
    """
    Executes Stage 4: Generates 12+ Vietnamese Hooks with complete Typography Plan.
    """
    logger.info(f"Running Stage 4 Vietnamese Hook Engine for story: {payload.story_id}")
    ai_engine = engine or GeminiApiEngine(default_model=model)

    user_prompt = (
        f"STORY ID: {payload.story_id}\n"
        f"STORY CORE: {dna_data.get('story_core')}\n"
        f"VICTIM: {dna_data.get('victim', {}).get('description')}\n"
        f"AGGRESSOR: {dna_data.get('aggressor', {}).get('description')}\n"
        f"RELATIONSHIP: {dna_data.get('relationship')}\n"
        f"DESIRE: {dna_data.get('desire')}\n"
        f"KEY PROP: {dna_data.get('key_prop')}\n"
        f"HIGH EMOTION MOMENT: {dna_data.get('high_emotion_moment')}\n"
        f"MYSTERY ELEMENT: {dna_data.get('mystery_element')}\n"
        f"WHAT NOT TO REVEAL: {json.dumps(dna_data.get('what_not_to_reveal', []), ensure_ascii=False)}\n\n"
        f"Hãy tạo ít nhất 12 text hooks tiếng Việt (4 Mystery, 4 Shock, 4 Emotional) kèm kế hoạch Typography đầy đủ theo schema JSON."
    )

    full_prompt = f"{THUMBNAIL_HOOKS_V1}\n\n{user_prompt}"

    try:
        response_text, model_used = await ai_engine.generate_content(
            prompt=full_prompt,
            model=model,
            temperature=0.5,
            max_output_tokens=3500
        )
        hooks_data = extract_json_from_response(response_text)
        raw_hooks = hooks_data.get("hooks", [])
        normalized_hooks = [normalize_hook_typography(h) for h in raw_hooks]
        hooks_data["hooks"] = normalized_hooks
        hooks_data["model_used"] = model_used
        hooks_data["prompt_version"] = PROMPT_VERSIONS["thumbnail_hooks"]
        logger.info(f"Stage 4 completed: generated {len(normalized_hooks)} hooks with typography plans.")
        return hooks_data
    except Exception as e:
        logger.error(f"Stage 4 Hook generation error: {e}", exc_info=True)
        # Safe fallback hooks with full typography plan
        fallback_hooks = [
            {
                "id": "hook_m1",
                "category": "mystery",
                "text": "KỶ VẬT GIA BẢO: BÍ MẬT 30 TỶ?",
                "lines": ["KỶ VẬT GIA BẢO:", "BÍ MẬT 30 TỶ?"],
                "primary_keywords": ["BÍ MẬT 30 TỶ"],
                "yellow_words": ["BÍ MẬT 30 TỶ?"],
                "red_words": ["KỶ VẬT GIA BẢO:"],
                "white_words": [],
                "typography_style": "mystery",
                "text_alignment": "left",
                "preferred_text_zone": "left",
                "hidden_information": "Giá trị thật của tài sản"
            },
            {
                "id": "hook_s1",
                "category": "shock",
                "text": "ÉP BỐ KÝ ĐẤT?",
                "lines": ["ÉP BỐ", "KÝ ĐẤT?"],
                "primary_keywords": ["KÝ ĐẤT"],
                "yellow_words": ["KÝ ĐẤT?"],
                "red_words": [],
                "white_words": ["ÉP BỐ"],
                "typography_style": "bold_shock",
                "text_alignment": "left",
                "preferred_text_zone": "left",
                "hidden_information": "Hành vi ép buộc ký giấy đất"
            },
            {
                "id": "hook_e1",
                "category": "emotional",
                "text": "MẸ GIÀ QUỲ LẠY – CON NÉM 200K",
                "lines": ["MẸ GIÀ QUỲ LẠY", "CON NÉM 200K"],
                "primary_keywords": ["QUỲ LẠY", "200K"],
                "yellow_words": ["CON NÉM 200K"],
                "red_words": ["MẸ GIÀ QUỲ LẠY"],
                "white_words": [],
                "typography_style": "emotional",
                "text_alignment": "left",
                "preferred_text_zone": "left",
                "hidden_information": "Nỗi đau của người mẹ quê"
            }
        ]
        return {
            "hooks": fallback_hooks,
            "prompt_version": PROMPT_VERSIONS["thumbnail_hooks"],
            "model_used": "fallback",
            "error": str(e)
        }
