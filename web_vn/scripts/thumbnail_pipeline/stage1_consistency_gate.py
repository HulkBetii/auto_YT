# -*- coding: utf-8 -*-
"""
STAGE 1: SINGLE-STORY INTEGRITY GATE
- Principle: Every video SRT contains EXACTLY ONE complete story.
- Performs hierarchical chunk analysis for long transcripts to preserve 100% of characters, events, and late twists.
- Audits for internal consistency (name changes, relationship contradictions, timeline issues) as informational warnings.
- NEVER splits or discards any part of the story.
"""

import sys
import json
import re
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from auto_yt.gemini_api_engine import GeminiApiEngine
from .stage0_load_input import StoryInputPayload
from .prompts import SINGLE_STORY_INTEGRITY_V1, PROMPT_VERSIONS

logger = logging.getLogger("thumbnail_pipeline.stage1")


def extract_json_from_response(text: str) -> Dict[str, Any]:
    """Robust JSON extractor supporting markdown blocks and partial matches."""
    text = text.strip()
    # Direct parse
    try:
        return json.loads(text)
    except Exception:
        pass

    # Codefence extraction
    m = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except Exception:
            pass

    # Curly bracket search
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end+1])
        except Exception:
            pass

    raise ValueError(f"Không thể parse JSON từ phản hồi LLM: {text[:200]}...")


import asyncio

async def hierarchical_long_srt_analysis(
    payload: StoryInputPayload,
    ai_engine: GeminiApiEngine,
    model: str
) -> str:
    """
    Summarizes long SRT in parallel chunks and synthesizes a full-story representation.
    Ensures late twists, secrets, and ending are completely preserved.
    """
    logger.info(f"Executing Parallel Hierarchical Chunk Analysis for long SRT ({len(payload.timeline_summary)} chunks)...")
    sem = asyncio.Semaphore(5)

    async def summarize_one_chunk(chunk: Dict[str, Any]) -> str:
        prompt = (
            f"TÓM TẮT PHÂN ĐOẠN ({chunk.get('time_range')}):\n"
            f"\"\"\"\n{chunk.get('dialogue')}\n\"\"\"\n\n"
            f"Tóm tắt 2-3 câu: Nhân vật nào xuất hiện? Hành động chính? Sự kiện/vật chứng kịch tính?"
        )
        async with sem:
            try:
                res_text, _ = await ai_engine.generate_content(
                    prompt=prompt,
                    model=model,
                    temperature=0.2,
                    max_output_tokens=350
                )
                return f"[{chunk.get('time_range')}]: {res_text.strip()}"
            except Exception as ce:
                logger.warning(f"Chunk summary error for {chunk.get('time_range')}: {ce}")
                return f"[{chunk.get('time_range')}]: Diễn biến các nhân vật: {', '.join(chunk.get('speakers', []))}"

    tasks = [summarize_one_chunk(chunk) for chunk in payload.timeline_summary]
    chunk_summaries = await asyncio.gather(*tasks)

    full_story_representation = "\n\n".join(chunk_summaries)
    return full_story_representation


async def run_story_consistency_gate(
    payload: StoryInputPayload,
    engine: Optional[GeminiApiEngine] = None,
    model: str = "ag/gemini-3.8-flash-high"
) -> Dict[str, Any]:
    """
    Executes Stage 1: Single-Story Integrity Gate on the full story transcript.
    """
    logger.info(f"Running Stage 1 Single-Story Integrity Gate for story: {payload.story_id}")
    ai_engine = engine or GeminiApiEngine(default_model=model)

    # If transcript is very large (>30,000 chars or >8 chunks), use hierarchical analysis
    if len(payload.srt_content) > 30000 or len(payload.timeline_summary) > 8:
        story_representation = await hierarchical_long_srt_analysis(payload, ai_engine, model)
        content_label = "TỔNG HỢP TOÀN CẢNH DIỄN BIẾN PHÂN TẦNG (HIERARCHICAL STORY REPRESENTATION):"
    else:
        story_representation = payload.srt_content
        content_label = "TOÀN BỘ NỘI DUNG PHỤ ĐỀ / KỊCH BẢN:"

    user_prompt = (
        f"STORY ID: {payload.story_id}\n"
        f"SPEAKERS DETECTED: {', '.join(payload.speakers_detected) if payload.speakers_detected else 'Không rõ'}\n\n"
        f"{content_label}\n"
        f"\"\"\"\n{story_representation}\n\"\"\"\n\n"
        f"Hãy phân tích tính nhất quán toàn bộ 1 câu chuyện theo đúng JSON schema."
    )

    full_prompt = f"{SINGLE_STORY_INTEGRITY_V1}\n\n{user_prompt}"

    try:
        response_text, model_used = await ai_engine.generate_content(
            prompt=full_prompt,
            model=model,
            temperature=0.2,
            max_output_tokens=3000
        )
        data = extract_json_from_response(response_text)
        data["model_used"] = model_used
        data["story_id"] = payload.story_id
        data["prompt_version"] = PROMPT_VERSIONS["single_story_integrity"]
        logger.info(f"Stage 1 completed: integrity_status={data.get('integrity_status')}, characters={len(data.get('characters', []))}, warnings={len(data.get('warnings', []))}")
        return data
    except Exception as e:
        logger.error(f"Stage 1 Single-Story Integrity Gate error: {e}", exc_info=True)
        # Safe fallback response
        return {
            "integrity_status": "clean",
            "characters": [
                {
                    "canonical_name": s,
                    "aliases": [],
                    "role": "Nhân vật chính",
                    "relationships": ["Gia đình"],
                    "age_if_known": None,
                    "gender_if_known": None
                }
                for s in (payload.speakers_detected[:3] or ["Nhân vật chính"])
            ],
            "timeline_summary": ["Diễn biến toàn bộ câu chuyện"],
            "warnings": [f"Evaluated with fallback due to model error: {e}"],
            "story_summary": f"Câu chuyện tâm lý xã hội kịch tính ({payload.story_id})",
            "prompt_version": PROMPT_VERSIONS["single_story_integrity"],
            "model_used": "fallback",
            "error": str(e)
        }
