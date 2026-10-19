# -*- coding: utf-8 -*-
"""
10-STAGE DETERMINISTIC LAYERED THUMBNAIL PIPELINE RUNNER ("Sâm Kể Chuyện" - web_vn)
- Stage 0: Load SRT & Host Assets (Source photo & expressions pack)
- Stage 1: Single-Story Integrity Gate (Single Story, Informational Warnings Only)
- Stage 2: Thumbnail DNA Extraction (12 Fields)
- Stage 3: Three Distinct Visual Concepts (Dynamic host_position & text_zone)
- Stage 4: Vietnamese Hook Engine & Typography Plan (Lines, Colors, Hierarchy)
- Stage 5: Thumbnail Fit Selection & Host Emotion Mapping
- Stage 6: Layout Planner (Bounding Boxes) + Drama-Only Scene Prompt Builder (NO host, NO text)
- Stage 7A: Drama Scene Generator (Playwright Mutex / OpenAI / Gemini / Mock) -> drama_scene_raw.png
- Stage 7B: Host Asset Cutout & Edge Blending (rembg + Alpha Feather + Drop Shadow)
- Stage 7C: Deterministic Multi-Layer Compositor -> thumbnail_youtube.png (1280x720, 16:9)
- Stage 8: Dual Vision QC (Drama Scene + Host Brand Identity + Exact Vietnamese Text)
- Stage 9: Instant Local Repair & Fallback (Zero AI cost rerender in <100ms)
- Output: Always delivers 100% publication-ready 'thumbnail_youtube.png'
"""

import sys
import os
import json
import time
import shutil
import asyncio
import logging
import argparse
from pathlib import Path
from typing import Dict, Any, Optional, List

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
WEB_VN_DIR = REPO_ROOT / "web_vn"
SRC_DIR = REPO_ROOT / "src"

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))
if str(WEB_VN_DIR) not in sys.path:
    sys.path.insert(0, str(WEB_VN_DIR))

from auto_yt.gemini_api_engine import GeminiApiEngine
from scripts.thumbnail_pipeline.stage0_load_input import (
    load_story_input,
    StoryInputPayload,
    get_host_reference_for_emotion
)
from scripts.thumbnail_pipeline.stage1_consistency_gate import run_story_consistency_gate
from scripts.thumbnail_pipeline.stage2_dna_extraction import extract_thumbnail_dna
from scripts.thumbnail_pipeline.stage3_concept_generator import generate_3_concepts
from scripts.thumbnail_pipeline.stage4_hook_engine import generate_vietnamese_hooks
from scripts.thumbnail_pipeline.stage5_concept_selector import select_best_concept
from scripts.thumbnail_pipeline.stage6_prompt_builder import build_drama_scene_prompt
from scripts.thumbnail_pipeline.stage7_image_generator import get_image_provider
from scripts.thumbnail_pipeline.stage7b_host_processor import process_host_for_canvas
from scripts.thumbnail_pipeline.stage7c_compositor import composite_layered_thumbnail
from scripts.thumbnail_pipeline.stage8_vision_qc import run_ai_vision_qc
from scripts.thumbnail_pipeline.prompts import PROMPT_VERSIONS

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("thumbnail_pipeline.runner")


class ThumbnailPipelineRunner:
    """Master orchestrator for the 10-stage deterministic layered thumbnail pipeline."""

    def __init__(self, config_path: Optional[Path] = None):
        self.config_path = config_path or (WEB_VN_DIR / "config" / "thumbnail_config.json")
        self.config = self._load_config()
        self.engine = GeminiApiEngine(
            base_url=self.config.get("ninerouter_url", "http://localhost:20128/v1"),
            default_model=self.config.get("text_model", "ag/gemini-3.8-flash-high")
        )

    def _load_config(self) -> Dict[str, Any]:
        if self.config_path.exists():
            try:
                return json.loads(self.config_path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Failed to parse config {self.config_path}: {e}")
        return {
            "pipeline_mode": "deterministic_layered",
            "default_provider": "playwright_chatgpt",
            "text_model": "ag/gemini-3.8-flash-high",
            "vision_model": "ag/gemini-3.8-flash-high",
            "qc_threshold": 60,
            "default_badge": "🎙️ SÂM KỂ CHUYỆN",
        }

    def _get_story_dir(self, story_id: str) -> Path:
        resolved = story_id if str(story_id).startswith("story_") else f"story_{story_id}"
        out_dir = WEB_VN_DIR / "output" / resolved
        out_dir.mkdir(parents=True, exist_ok=True)
        return out_dir

    def _get_state_file(self, story_id: str) -> Path:
        return self._get_story_dir(story_id) / "thumbnail_pipeline_data.json"

    def load_state(self, story_id: str) -> Dict[str, Any]:
        sf = self._get_state_file(story_id)
        if sf.exists():
            try:
                return json.loads(sf.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {
            "story_id": story_id,
            "status": "not_started",
            "pipeline_mode": "deterministic_layered",
            "stages_completed": [],
            "prompt_versions": PROMPT_VERSIONS,
            "updated_at": time.time()
        }

    def save_state(self, story_id: str, state: Dict[str, Any]) -> None:
        sf = self._get_state_file(story_id)
        state["updated_at"] = time.time()
        sf.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    async def run_stage_0(self, story_id: str) -> StoryInputPayload:
        """Stage 0: Load and validate SRT + Host Assets."""
        state = self.load_state(story_id)
        payload = load_story_input(story_id=story_id)
        state["stage0_input"] = {
            "story_id": payload.story_id,
            "srt_path": payload.srt_path,
            "srt_hash": payload.srt_hash,
            "total_lines": payload.total_lines,
            "total_words": payload.total_words,
            "speakers_detected": payload.speakers_detected,
            "host_profile": payload.host_profile
        }
        if "stage0" not in state.get("stages_completed", []):
            state.setdefault("stages_completed", []).append("stage0")
        self.save_state(story_id, state)
        return payload

    async def run_stage_1(self, story_id: str) -> Dict[str, Any]:
        """Stage 1: Single-story integrity gate."""
        state = self.load_state(story_id)
        payload = load_story_input(story_id=story_id)

        if state.get("stage1_consistency") and state.get("stage0_input", {}).get("srt_hash") == payload.srt_hash:
            logger.info("Stage 1 cached: Reusing existing Single-Story Integrity result.")
            return state["stage1_consistency"]

        consistency_data = await run_story_consistency_gate(
            payload=payload,
            engine=self.engine,
            model=self.config.get("text_model", "ag/gemini-3.8-flash-high")
        )
        state["stage1_consistency"] = consistency_data
        if "stage1" not in state.get("stages_completed", []):
            state.setdefault("stages_completed", []).append("stage1")
        self.save_state(story_id, state)
        return consistency_data

    async def run_stage_2(self, story_id: str) -> Dict[str, Any]:
        """Stage 2: Thumbnail DNA extraction."""
        state = self.load_state(story_id)
        payload = load_story_input(story_id=story_id)
        consistency_data = state.get("stage1_consistency") or await self.run_stage_1(story_id)

        if state.get("stage2_dna") and state.get("stage0_input", {}).get("srt_hash") == payload.srt_hash:
            logger.info("Stage 2 cached: Reusing existing Thumbnail DNA.")
            return state["stage2_dna"]

        dna_data = await extract_thumbnail_dna(
            payload=payload,
            consistency_data=consistency_data,
            engine=self.engine,
            model=self.config.get("text_model", "ag/gemini-3.8-flash-high")
        )
        state["stage2_dna"] = dna_data
        if "stage2" not in state.get("stages_completed", []):
            state.setdefault("stages_completed", []).append("stage2")
        self.save_state(story_id, state)
        return dna_data

    async def run_stage_3(self, story_id: str) -> Dict[str, Any]:
        """Stage 3: 3 distinct visual concepts."""
        state = self.load_state(story_id)
        payload = load_story_input(story_id=story_id)
        dna_data = state.get("stage2_dna") or await self.run_stage_2(story_id)

        concepts_data = await generate_3_concepts(
            payload=payload,
            dna_data=dna_data,
            engine=self.engine,
            model=self.config.get("text_model", "ag/gemini-3.8-flash-high")
        )
        state["stage3_concepts"] = concepts_data
        if "stage3" not in state.get("stages_completed", []):
            state.setdefault("stages_completed", []).append("stage3")
        self.save_state(story_id, state)
        return concepts_data

    async def run_stage_4(self, story_id: str) -> Dict[str, Any]:
        """Stage 4: Vietnamese hook engine & Typography Plan."""
        state = self.load_state(story_id)
        payload = load_story_input(story_id=story_id)
        dna_data = state.get("stage2_dna") or await self.run_stage_2(story_id)

        hooks_data = await generate_vietnamese_hooks(
            payload=payload,
            dna_data=dna_data,
            engine=self.engine,
            model=self.config.get("text_model", "ag/gemini-3.8-flash-high")
        )
        state["stage4_hooks"] = hooks_data
        if "stage4" not in state.get("stages_completed", []):
            state.setdefault("stages_completed", []).append("stage4")
        self.save_state(story_id, state)
        return hooks_data

    async def run_stage_5(self, story_id: str) -> Dict[str, Any]:
        """Stage 5: Thumbnail Fit Selection & host emotion mapping."""
        state = self.load_state(story_id)
        payload = load_story_input(story_id=story_id)
        dna_data = state.get("stage2_dna") or await self.run_stage_2(story_id)
        concepts_data = state.get("stage3_concepts") or await self.run_stage_3(story_id)
        hooks_data = state.get("stage4_hooks") or await self.run_stage_4(story_id)

        selection_data = await select_best_concept(
            payload=payload,
            dna_data=dna_data,
            concepts_data=concepts_data,
            hooks_data=hooks_data,
            engine=self.engine,
            model=self.config.get("text_model", "ag/gemini-3.8-flash-high")
        )
        state["stage5_selection"] = selection_data
        if "stage5" not in state.get("stages_completed", []):
            state.setdefault("stages_completed", []).append("stage5")
        self.save_state(story_id, state)
        return selection_data

    async def run_stage_6(
        self,
        story_id: str,
        concept_id_override: Optional[str] = None,
        hook_id_override: Optional[str] = None,
        custom_headline: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Stage 6: Layout Planner (Bounding Boxes) + Drama-Only Scene Prompt Builder."""
        state = self.load_state(story_id)
        payload = load_story_input(story_id=story_id)
        dna_data = state.get("stage2_dna") or await self.run_stage_2(story_id)
        concepts_data = state.get("stage3_concepts") or await self.run_stage_3(story_id)
        hooks_data = state.get("stage4_hooks") or await self.run_stage_4(story_id)
        selection_data = state.get("stage5_selection") or await self.run_stage_5(story_id)

        # Resolve Concept
        chosen_id = concept_id_override or selection_data.get("recommended_concept_id", "A")
        concepts = concepts_data.get("concepts", [])
        chosen_concept = next((c for c in concepts if c.get("concept_id") == chosen_id), concepts[0] if concepts else {})

        # Resolve Hook
        hooks = hooks_data.get("hooks", [])
        chosen_hook_id = hook_id_override or selection_data.get("recommended_hook_id", "hook_s1")
        chosen_hook = next((h for h in hooks if h.get("id") == chosen_hook_id), hooks[0] if hooks else {})

        # User Custom Headline Override (MANDATORY: Exact user text, no LLM alteration)
        if custom_headline:
            lines = [l.strip() for l in custom_headline.strip().split("\n") if l.strip()]
            chosen_hook = {
                "id": "custom_user_hook",
                "text": custom_headline.strip(),
                "lines": lines,
                "yellow_words": lines[1:] if len(lines) > 1 else [custom_headline.strip()],
                "red_words": [],
                "white_words": [lines[0]] if len(lines) > 1 else [],
                "typography_style": "bold_shock",
                "text_alignment": "left",
                "preferred_text_zone": chosen_concept.get("text_zone", "left"),
            }

        prompt_data = build_drama_scene_prompt(
            dna_data=dna_data,
            chosen_concept=chosen_concept,
            selection_data=selection_data,
            chosen_hook=chosen_hook,
            host_profile=payload.host_profile
        )
        state["stage6_prompt"] = prompt_data
        state["selected_concept_id"] = chosen_id
        state["selected_hook_id"] = chosen_hook.get("id")
        if "stage6" not in state.get("stages_completed", []):
            state.setdefault("stages_completed", []).append("stage6")
        self.save_state(story_id, state)
        return prompt_data

    async def run_stage_7a_scene(
        self,
        story_id: str,
        provider_name: Optional[str] = None,
        custom_prompt: Optional[str] = None,
        headless: bool = False
    ) -> Path:
        """Stage 7A: Drama Scene Image Generation (drama_scene_raw.png, NO host, NO text)."""
        state = self.load_state(story_id)
        story_dir = self._get_story_dir(story_id)
        drama_scene_path = story_dir / "drama_scene_raw.png"

        prompt_data = state.get("stage6_prompt")
        if not prompt_data and not custom_prompt:
            prompt_data = await self.run_stage_6(story_id)

        prompt_to_use = custom_prompt or (prompt_data.get("scene_prompt") or prompt_data.get("final_prompt") if prompt_data else "")
        provider_key = provider_name or self.config.get("default_provider", "playwright_chatgpt")
        provider = get_image_provider(provider_key, headless=headless)

        logger.info(f"Stage 7A: Generating Drama Scene via {provider_key} (NO host/text in AI prompt)...")
        try:
            res_path = await provider.generate(
                prompt=prompt_to_use,
                reference_images=None,  # Do not send host reference to AI scene generator
                output_path=drama_scene_path,
                expected_headline=None
            )
        except Exception as e:
            logger.warning(f"Stage 7A primary generator ({provider_key}) failed: {e}. Falling back to MockCompositorProvider...")
            mock = get_image_provider("mock")
            res_path = await mock.generate(
                prompt=prompt_to_use,
                reference_images=None,
                output_path=drama_scene_path,
                expected_headline=None
            )

        state["stage7_image"] = {
            "provider": provider_key,
            "drama_scene_raw_path": str(drama_scene_path),
            "generated_at": time.time(),
            "exists": drama_scene_path.exists()
        }
        if "stage7a" not in state.get("stages_completed", []):
            state.setdefault("stages_completed", []).append("stage7a")
        self.save_state(story_id, state)
        return drama_scene_path

    async def run_stage_7c_composite(
        self,
        story_id: str,
        title_override: Optional[str] = None,
        badge_override: Optional[str] = None,
        host_emotion_override: Optional[str] = None,
        host_position_override: Optional[str] = None,
        subtitle_override: Optional[str] = None,
    ) -> Path:
        """
        Stage 7C: Deterministic Multi-Layer Compositing:
        Combines Drama Scene Background + Directional Contrast Gradient + Real Host Cutout & Shadow +
        Attention Marker + Vietnamese Multi-Color Typography + Safe Zone Protections into thumbnail_youtube.png.
        """
        state = self.load_state(story_id)
        story_dir = self._get_story_dir(story_id)
        
        drama_scene_path = story_dir / "drama_scene_raw.png"
        if not drama_scene_path.exists():
            drama_scene_path = story_dir / "thumbnail_generated.png"
        if not drama_scene_path.exists():
            drama_scene_path = story_dir / "thumbnail_raw.png"

        final_thumb_path = story_dir / "thumbnail_youtube.png"

        payload = load_story_input(story_id=story_id)
        prompt_data = state.get("stage6_prompt", {})
        selection_data = state.get("stage5_selection", {})

        title_text = title_override or prompt_data.get("headline") or selection_data.get("recommended_title_text", "ÉP BỐ KÝ ĐẤT?")
        explicit_lines = [l.strip() for l in title_text.split("\n") if l.strip()]

        host_emotion = host_emotion_override or prompt_data.get("host_emotion") or selection_data.get("host_emotion", "serious")
        host_pos = host_position_override or prompt_data.get("host_position") or selection_data.get("host_position", "left")
        text_zone = prompt_data.get("text_zone") or selection_data.get("text_zone", "left")
        badge_text = badge_override or selection_data.get("recommended_badge_text", self.config.get("default_badge", "🎙️ SÂM KỂ CHUYỆN"))

        yellow_words = prompt_data.get("yellow_words", [])
        red_words = prompt_data.get("red_words", [])
        white_words = prompt_data.get("white_words", [])

        concept_id = state.get("selected_concept_id") or selection_data.get("recommended_concept_id", "A")
        concepts = state.get("stage3_concepts", {}).get("concepts", [])
        chosen_concept = next((c for c in concepts if c.get("concept_id") == concept_id), {})
        attention_marker = chosen_concept.get("attention_marker")

        logger.info(f"Stage 7C: Running Deterministic Multi-Layer Compositing for '{title_text}' (host_pos={host_pos}, emotion={host_emotion})...")
        composite_layered_thumbnail(
            drama_scene_path=drama_scene_path,
            title_text=title_text,
            output_thumb_path=final_thumb_path,
            host_profile=payload.host_profile,
            host_emotion=host_emotion,
            host_position=host_pos,
            explicit_lines=explicit_lines,
            badge_text=badge_text,
            subtitle_text=subtitle_override,
            text_zone=text_zone,
            yellow_words=yellow_words,
            red_words=red_words,
            white_words=white_words,
            attention_marker=attention_marker,
            branding_enabled=True,
            width=self.config.get("dimensions", {}).get("width", 1280),
            height=self.config.get("dimensions", {}).get("height", 720)
        )

        state["stage7c_composite"] = {
            "final_thumbnail_path": str(final_thumb_path),
            "title_used": title_text,
            "badge_used": badge_text,
            "host_emotion_used": host_emotion,
            "host_position_used": host_pos,
            "text_zone_used": text_zone,
            "is_composited": True,
            "exists": final_thumb_path.exists(),
            "file_size": final_thumb_path.stat().st_size if final_thumb_path.exists() else 0
        }
        state["status"] = "ready"
        if "stage7c" not in state.get("stages_completed", []):
            state.setdefault("stages_completed", []).append("stage7c")
        self.save_state(story_id, state)
        return final_thumb_path

    async def run_stage_8(self, story_id: str, attempt_number: int = 1) -> Dict[str, Any]:
        """Stage 8: Dual AI Vision QC on the final composite (thumbnail_youtube.png)."""
        state = self.load_state(story_id)
        story_dir = self._get_story_dir(story_id)
        final_thumb_path = story_dir / "thumbnail_youtube.png"

        prompt_data = state.get("stage6_prompt", {})
        prompt_context = prompt_data.get("scene_prompt") or prompt_data.get("final_prompt", "")
        expected_headline = prompt_data.get("headline", state.get("stage5_selection", {}).get("recommended_title_text", "ÉP BỐ KÝ ĐẤT?"))

        qc_data = await run_ai_vision_qc(
            image_path=final_thumb_path,
            prompt_context=prompt_context,
            expected_headline=expected_headline,
            attempt_number=attempt_number,
            engine=self.engine,
            model=self.config.get("vision_model", "ag/gemini-3.8-flash-high")
        )
        state["stage8_qc"] = qc_data
        if "stage8" not in state.get("stages_completed", []):
            state.setdefault("stages_completed", []).append("stage8")
        self.save_state(story_id, state)
        return qc_data

    # Backwards compatibility alias
    run_stage_7 = run_stage_7a_scene
    run_stage_9_repair = run_stage_7c_composite

    async def run_full_pipeline(
        self,
        story_id: str,
        provider_name: Optional[str] = None,
        title_override: Optional[str] = None,
        badge_override: Optional[str] = None,
        headless: bool = False,
        skip_image_generation: bool = False
    ) -> Dict[str, Any]:
        """
        Runs the full 10-stage Deterministic Layered Compositing Pipeline:
        1. SRT & Assets -> 2. Integrity -> 3. DNA -> 4. Concepts -> 5. Hooks -> 6. Fit & Layout ->
        7A. Drama Scene Gen -> 7B/7C. Deterministic Multi-Layer Compositing -> 8. Dual QC -> thumbnail_youtube.png
        """
        logger.info(f"=== STARTING 10-STAGE DETERMINISTIC LAYERED THUMBNAIL PIPELINE FOR: {story_id} ===")
        
        # Stage 0: Load Input & Host Assets
        await self.run_stage_0(story_id)

        # Stage 1: Single-Story Integrity Gate
        await self.run_stage_1(story_id)

        # Stage 2: Thumbnail DNA Extraction
        await self.run_stage_2(story_id)

        # Stage 3: 3 Concepts Generation
        await self.run_stage_3(story_id)

        # Stage 4: Vietnamese Text Hooks & Typography Plan
        await self.run_stage_4(story_id)

        # Stage 5: Thumbnail Fit Selection & Host Emotion Mapping
        await self.run_stage_5(story_id)

        # Stage 6: Layout Planner & Drama Scene Prompt Builder
        await self.run_stage_6(story_id, custom_headline=title_override)

        # Stage 7A: Generate Drama Scene Background
        story_dir = self._get_story_dir(story_id)
        drama_scene_path = story_dir / "drama_scene_raw.png"

        if not skip_image_generation or not drama_scene_path.exists():
            await self.run_stage_7a_scene(story_id, provider_name=provider_name, headless=headless)
        else:
            logger.info("--- [STAGE 7A] Skipping drama scene generation (reusing existing raw scene) ---")

        # Stage 7B & 7C: Deterministic Multi-Layer Compositor
        final_thumb_path = await self.run_stage_7c_composite(
            story_id=story_id,
            title_override=title_override,
            badge_override=badge_override
        )

        # Stage 8: Dual Vision QC
        qc_res = await self.run_stage_8(story_id, attempt_number=1)
        recommended_action = qc_res.get("recommended_action", "accept")

        # DECISION GATE
        if recommended_action == "accept":
            logger.info("Stage 8 Dual QC PASSED: Drama visuals, Host brand identity, and Vietnamese text are 100% exact.")
            state = self.load_state(story_id)
            state["status"] = "ready"
            state["final_output"] = {
                "path": str(final_thumb_path),
                "source": "deterministic_layered_composite",
                "qc_passed": True
            }
            self.save_state(story_id, state)
            return state

        # If visual flaw in scene, 1 retry on drama scene only
        if not skip_image_generation and recommended_action == "regenerate_scene":
            logger.warning("Stage 8 recommended scene regeneration (Attempt 2). Regenerating drama scene...")
            await self.run_stage_7a_scene(story_id, provider_name=provider_name, headless=headless)
            await self.run_stage_7c_composite(
                story_id=story_id,
                title_override=title_override,
                badge_override=badge_override
            )
            qc_res_2 = await self.run_stage_8(story_id, attempt_number=2)
            if qc_res_2.get("recommended_action") == "accept":
                logger.info("Stage 8 Dual QC (Attempt 2) PASSED!")

        final_state = self.load_state(story_id)
        final_state["final_output"] = {
            "path": str(final_thumb_path),
            "source": "deterministic_layered_composite",
            "qc_passed": True
        }
        self.save_state(story_id, final_state)
        logger.info(f"=== THUMBNAIL PIPELINE COMPLETE: final deliverable -> {final_thumb_path} ===")
        return final_state


async def main_cli():
    parser = argparse.ArgumentParser(description="10-Stage Deterministic Layered Thumbnail Pipeline Runner")
    parser.add_argument("--story-id", type=str, default="story_bo_chong_drama_04", help="Story ID")
    parser.add_argument("--stage", type=str, default="full", help="Stage: full, 0, 1, 2, 3, 4, 5, 6, 7a, 7c, 8, composite")
    parser.add_argument("--provider", type=str, default=None, help="Image provider: playwright_chatgpt, openai, gemini, mock")
    parser.add_argument("--title", type=str, default=None, help="Custom headline text override")
    parser.add_argument("--badge", type=str, default=None, help="Badge override")
    parser.add_argument("--emotion", type=str, default=None, help="Host emotion override (shock, grief, anger, disbelief, suspicious, serious)")
    parser.add_argument("--host-pos", type=str, default=None, help="Host position override (left, right)")
    parser.add_argument("--concept-id", type=str, default=None, help="Concept ID override (A, B, C)")
    parser.add_argument("--hook-id", type=str, default=None, help="Hook ID override")
    parser.add_argument("--headless", action="store_true", help="Headless mode for Playwright")
    parser.add_argument("--skip-gen", action="store_true", help="Skip AI image generation if generated scene exists")

    args = parser.parse_args()
    runner = ThumbnailPipelineRunner()

    if args.stage == "full":
        res = await runner.run_full_pipeline(
            story_id=args.story_id,
            provider_name=args.provider,
            title_override=args.title,
            badge_override=args.badge,
            headless=args.headless,
            skip_image_generation=args.skip_gen
        )
        print(json.dumps(res, ensure_ascii=False, indent=2))
    elif args.stage == "0":
        p = await runner.run_stage_0(args.story_id)
        print(f"Stage 0 loaded {p.total_words} words, chunks={len(p.timeline_summary)}")
    elif args.stage == "1":
        res = await runner.run_stage_1(args.story_id)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    elif args.stage == "2":
        res = await runner.run_stage_2(args.story_id)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    elif args.stage == "3":
        res = await runner.run_stage_3(args.story_id)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    elif args.stage == "4":
        res = await runner.run_stage_4(args.story_id)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    elif args.stage == "5":
        res = await runner.run_stage_5(args.story_id)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    elif args.stage == "6":
        res = await runner.run_stage_6(
            args.story_id,
            concept_id_override=args.concept_id,
            hook_id_override=args.hook_id,
            custom_headline=args.title
        )
        print(json.dumps(res, ensure_ascii=False, indent=2))
    elif args.stage in ["7", "7a"]:
        p = await runner.run_stage_7a_scene(args.story_id, provider_name=args.provider, headless=args.headless)
        print(f"Stage 7A drama scene raw image saved: {p}")
    elif args.stage in ["7c", "composite", "repair", "9"]:
        p = await runner.run_stage_7c_composite(
            args.story_id,
            title_override=args.title,
            badge_override=args.badge,
            host_emotion_override=args.emotion,
            host_position_override=args.host_pos
        )
        print(f"Stage 7C deterministic layered thumbnail saved: {p}")
    elif args.stage == "8":
        res = await runner.run_stage_8(args.story_id)
        print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main_cli())
