# -*- coding: utf-8 -*-
"""
STAGE 6: LAYOUT PLANNER & DRAMA SCENE PROMPT BUILDER
- Computes normalized bounding boxes for deterministic layered compositing:
  * host_box: [x_min, y_min, x_max, y_max]
  * headline_zone: [x_min, y_min, x_max, y_max]
  * drama_zone: [x_min, y_min, x_max, y_max]
- Builds Drama-Only photorealistic prompt for Stage 7A (NO host, NO text in AI prompt)
- Enforces strict Anti-AI photorealism (real skin pores, fine wrinkles, natural fabric, no plastic/wax smoothing)
- Applies Safety-Aware Prompt Adapter (sanitizes explicit violence into intense family drama)
"""

import sys
import re
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple

logger = logging.getLogger("thumbnail_pipeline.stage6")

ANTI_AI_REALISM_BLOCK = (
    "Authentic photorealistic documentary drama photography. "
    "True-to-life human anatomy: authentic Vietnamese facial features, natural skin texture with visible pores, "
    "fine crow's feet and age lines, natural under-eye texture, subtle imperfections, slight perspiration, and natural flyaway hair strands. "
    "Realistic Vietnamese clothing textures: genuine fabric weave, natural wrinkles, authentic cotton folds. "
    "High-contrast directional drama lighting with deep cinematic shadows and natural falloff, no artificial CGI gloss, "
    "no plastic/wax skin smoothing, no uncanny doll eyes, no oversaturated cartoon or 3D render look."
)

NEGATIVE_EXCLUSIONS_BLOCK = (
    "CRITICAL NEGATIVE CONSTRAINTS: Absolutely DO NOT include any host, narrator, presenter, podcast microphone, formal studio suit, or glasses-wearing narrator. "
    "DO NOT include any text, typography, letters, words, headlines, subtitles, logos, watermarks, or artificial graphic overlays. "
    "NO extra fingers, NO distorted hands, NO mutated limbs, NO smiling or cartoonish expressions, NO anime look, NO 3D render look, NO graphic gore or physical violence. "
    "Keep the designated negative space dark, moody, and clean."
)

GUARDRAIL_REPLACEMENTS = [
    (r'\bném\s*(mạnh|thẳng)?\b', 'vung tay chỉ về phía'),
    (r'\bsỉ\s*nhục\b', 'tranh cãi gay gắt với'),
    (r'\bdữ\s*tợn\b', 'sắc lạnh và nghiêm khắc'),
    (r'\bhành\s*hạ\b', 'đối xử lạnh lùng với'),
    (r'\bngược\s*đãi\b', 'bất hòa gay gắt với'),
    (r'\bbạo\s*lực\b', 'căng thẳng tâm lý'),
    (r'\bchết\s*lặng\b', 'sững sờ bàng hoàng'),
    (r'\bquỳ\s*lạy\b', 'ngồi sụp xuống nghẹn ngào'),
    (r'\bcướp\s*đoạt\b', 'tranh chấp quyền lợi'),
    (r'\bđánh\s*đập\b', 'áp bức tinh thần'),
    (r'\bmáu\s*me\b', 'vết trầy xước nhẹ'),
    (r'\battack\b', 'intense emotional confrontation'),
    (r'\bviolence\b', 'family drama tension'),
    (r'\babuse\b', 'emotional discord'),
    (r'\bthrowing\b', 'pointing gesturing towards'),
    (r'\bhitting\b', 'confronting'),
    (r'\bviolent\b', 'dramatic'),
]


def sanitize_dalle_guardrails(text: str) -> str:
    """Safety-Aware Prompt Adapter: Sanitizes explicit physical violence into high-tension drama."""
    sanitized = text
    for pattern, replacement in GUARDRAIL_REPLACEMENTS:
        sanitized = re.sub(pattern, replacement, sanitized, flags=re.IGNORECASE)
    return sanitized


def create_safe_reformulation(prompt: str, headline: str = "") -> str:
    """Generates a safe fallback reformulation if image generation is refused by safety filters."""
    safe_prompt = (
        f"A cinematic 16:9 photorealistic dramatic background scene for Vietnamese family drama storytelling. "
        f"Authentic Vietnamese family members in an intense emotional conversation in a moody room. "
        f"Photorealistic 35mm film still, visible skin pores, natural fabric wrinkles, NO text, NO host, NO violence, NO 3D render."
    )
    return safe_prompt


def calculate_layout_zones(
    host_pos: str = "left",
    text_zone: str = "left",
) -> Dict[str, List[float]]:
    """
    Calculates normalized bounding boxes [x_min, y_min, x_max, y_max] for 1280x720 canvas:
    - host_box
    - headline_zone
    - drama_zone
    - badge_zone
    """
    host_pos = host_pos.lower()
    text_zone = text_zone.lower()

    # Host bounding box
    if host_pos == "right":
        host_box = [0.60, 0.25, 1.00, 1.00]
    else:
        host_box = [0.00, 0.25, 0.40, 1.00]

    # Headline bounding zone
    if text_zone == "right":
        headline_zone = [0.52, 0.06, 0.98, 0.48]
    elif text_zone == "top-right":
        headline_zone = [0.52, 0.05, 0.98, 0.42]
    elif text_zone == "bottom-right":
        headline_zone = [0.52, 0.50, 0.98, 0.88]
    elif text_zone == "top-left":
        headline_zone = [0.02, 0.05, 0.48, 0.42]
    elif text_zone == "bottom-left":
        headline_zone = [0.02, 0.50, 0.48, 0.88]
    elif text_zone == "bottom-center":
        headline_zone = [0.20, 0.55, 0.80, 0.92]
    else:  # default "left"
        headline_zone = [0.02, 0.06, 0.48, 0.48]

    # Drama Scene focus zone (opposite to host & text where possible)
    if host_pos == "left" or text_zone == "left":
        drama_zone = [0.38, 0.00, 1.00, 1.00]
    else:
        drama_zone = [0.00, 0.00, 0.62, 1.00]

    badge_zone = [0.02, 0.02, 0.30, 0.08]

    return {
        "host_box": host_box,
        "headline_zone": headline_zone,
        "drama_zone": drama_zone,
        "badge_zone": badge_zone,
    }


def build_drama_scene_prompt(
    dna_data: Dict[str, Any],
    chosen_concept: Dict[str, Any],
    selection_data: Dict[str, Any],
    chosen_hook: Dict[str, Any],
    host_profile: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Builds the Drama-Only scene prompt for Stage 7A in Deterministic Layered Compositing.
    The generated image contains ONLY story characters and environment, NO host, NO text.
    """
    text_zone = chosen_concept.get("text_zone", selection_data.get("text_zone", "left")).lower()
    host_pos = chosen_concept.get("host_position", selection_data.get("host_position", "left")).lower()
    host_emotion = selection_data.get("host_emotion") or chosen_concept.get("host_emotion", "serious")

    # Layout geometry
    layout_zones = calculate_layout_zones(host_pos=host_pos, text_zone=text_zone)

    # Characters description
    main_subj = sanitize_dalle_guardrails(str(chosen_concept.get("main_subject", dna_data.get("victim", {}).get("description", "Vietnamese protagonist"))))
    sec_subj = sanitize_dalle_guardrails(str(chosen_concept.get("secondary_subject", dna_data.get("aggressor", {}).get("description", "Vietnamese antagonist"))))
    opt_subj = chosen_concept.get("optional_supporting_subject")

    char_lines = [
        f"- Primary Character: {main_subj}.",
        f"- Secondary Confrontation Character: {sec_subj}."
    ]
    if opt_subj:
        char_lines.append(f"- Supporting Character: {sanitize_dalle_guardrails(str(opt_subj))}.")

    key_prop = sanitize_dalle_guardrails(str(chosen_concept.get("key_prop") or dna_data.get("key_prop", "a symbolic clue")))
    setting = sanitize_dalle_guardrails(str(chosen_concept.get("setting") or dna_data.get("setting", "authentic Vietnamese setting")))
    story_moment = sanitize_dalle_guardrails(str(chosen_concept.get("story_moment", dna_data.get("high_emotion_moment", "confrontation moment"))))
    vn_context = ", ".join(dna_data.get("vietnamese_context", ["Authentic Vietnamese lifestyle", "realistic clothing"]))
    visual_question = str(chosen_concept.get("visual_question") or dna_data.get("visual_question", "What dark family secret is happening?"))
    what_not_to_reveal = ", ".join(dna_data.get("what_not_to_reveal", ["The final twist ending"]))

    # Headline info for downstream compositor
    headline_text = chosen_hook.get("text") or selection_data.get("recommended_title_text", "ÉP BỐ KÝ ĐẤT?")
    headline_lines = chosen_hook.get("lines") or [headline_text]
    yellow_words = chosen_hook.get("yellow_words") or []
    red_words = chosen_hook.get("red_words") or []
    white_words = chosen_hook.get("white_words") or [l for l in headline_lines if l not in yellow_words and l not in red_words]

    # Camera composition directions
    if host_pos == "left" or text_zone == "left":
        comp_direct = (
            "- Composition: Cinematic 16:9 wide shot.\n"
            "- Right 55-60% of canvas: Main dramatic action in sharp focus, high emotional tension between characters and clearly visible key prop.\n"
            "- Left 40-45% of canvas: Moody, darker atmospheric background with deep shadows and soft vignette, reserved for studio foreground overlay."
        )
    else:
        comp_direct = (
            "- Composition: Cinematic 16:9 wide shot.\n"
            "- Left 55-60% of canvas: Main dramatic action in sharp focus, high emotional tension between characters and clearly visible key prop.\n"
            "- Right 40-45% of canvas: Moody, darker atmospheric background with deep shadows and soft vignette, reserved for studio foreground overlay."
        )

    prompt_lines = [
        "Create a photorealistic cinematic 16:9 drama background scene for a Vietnamese family storytelling production.",
        "Focus purely on the intense story scene and the authentic characters inside the drama.",
        "",
        "### 1. DRAMA SCENE & EMOTIONAL MOMENT:",
        f"- Core Story Moment: {story_moment}.",
        f"- Setting: {setting}.",
        f"- Vietnamese Context: {vn_context}.",
        f"- Visual Atmosphere: Evoke the dramatic question: '{visual_question}' (Do NOT show: {what_not_to_reveal}).",
        "\n".join(char_lines),
        f"- Key Story Prop: {key_prop}, prominently positioned in the scene.",
        "",
        "### 2. CAMERA COMPOSITION & LIGHTING:",
        comp_direct,
        "- High dynamic range, directional drama spotlight illuminating character expressions and the key prop.",
        "- Canvas aspect ratio: 16:9 (1280x720).",
        "",
        "### 3. PHOTOGRAPHIC REALISM STANDARD (ANTI-AI):",
        ANTI_AI_REALISM_BLOCK,
        "",
        NEGATIVE_EXCLUSIONS_BLOCK,
    ]

    scene_prompt = "\n".join(prompt_lines).strip()

    # Condensed prompt optimized for DALL-E 3
    condensed_scene_prompt = (
        f"Cinematic 16:9 photorealistic Vietnamese family drama scene: {story_moment}. "
        f"Characters: {main_subj} vs {sec_subj}. Prop: {key_prop}. Setting: {setting}. "
        f"Photorealistic 35mm film still, visible skin pores, natural cotton clothes, moody directional lighting. "
        f"NO text, NO words, NO letters, NO host, NO microphone, NO 3D render, NO cartoon."
    )

    result = {
        "scene_prompt": scene_prompt,
        "condensed_scene_prompt": condensed_scene_prompt,
        "final_prompt": scene_prompt,
        "condensed_prompt": condensed_scene_prompt,
        "concept_id": chosen_concept.get("concept_id", "A"),
        "headline": headline_text,
        "headline_lines": headline_lines,
        "yellow_words": yellow_words,
        "red_words": red_words,
        "white_words": white_words,
        "text_zone": text_zone,
        "host_position": host_pos,
        "host_emotion": host_emotion,
        "aspect_ratio": "16:9",
        "layout_zones": layout_zones,
        "anti_ai_block": ANTI_AI_REALISM_BLOCK,
        "negative_block": NEGATIVE_EXCLUSIONS_BLOCK,
    }

    logger.info(f"Stage 6 built drama-only scene prompt ({len(scene_prompt)} chars, host_pos={host_pos}, text_zone={text_zone})")
    return result


# Backwards compatibility alias
build_full_thumbnail_prompt = build_drama_scene_prompt
build_anti_ai_image_prompt = build_drama_scene_prompt
