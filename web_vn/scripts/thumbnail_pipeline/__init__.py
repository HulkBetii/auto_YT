# -*- coding: utf-8 -*-
"""
Thumbnail Generation Pipeline Package for web_vn
10-stage deterministic layered high-CTR YouTube thumbnail generator ("Sâm Kể Chuyện")
"""

from .stage0_load_input import load_story_input, HostAssetProfile
from .stage1_consistency_gate import run_story_consistency_gate
from .stage2_dna_extraction import extract_thumbnail_dna
from .stage3_concept_generator import generate_3_concepts
from .stage4_hook_engine import generate_vietnamese_hooks
from .stage5_concept_selector import select_best_concept, map_host_expression
from .stage6_prompt_builder import build_drama_scene_prompt, build_full_thumbnail_prompt, calculate_layout_zones
from .stage7_image_generator import (
    ThumbnailImageProvider,
    PlaywrightChatGPTImageProvider,
    OpenAIImageProvider,
    GeminiImageProvider,
    MockCompositorProvider,
    get_image_provider
)
from .stage7b_host_processor import process_host_for_canvas, ensure_host_cutout
from .stage7c_compositor import composite_layered_thumbnail, composite_vietnamese_thumbnail
from .stage8_vision_qc import run_ai_vision_qc
from .pipeline_runner import ThumbnailPipelineRunner

__all__ = [
    "load_story_input",
    "HostAssetProfile",
    "run_story_consistency_gate",
    "extract_thumbnail_dna",
    "generate_3_concepts",
    "generate_vietnamese_hooks",
    "select_best_concept",
    "map_host_expression",
    "build_drama_scene_prompt",
    "build_full_thumbnail_prompt",
    "calculate_layout_zones",
    "ThumbnailImageProvider",
    "PlaywrightChatGPTImageProvider",
    "OpenAIImageProvider",
    "GeminiImageProvider",
    "MockCompositorProvider",
    "get_image_provider",
    "process_host_for_canvas",
    "ensure_host_cutout",
    "composite_layered_thumbnail",
    "composite_vietnamese_thumbnail",
    "run_ai_vision_qc",
    "ThumbnailPipelineRunner",
]
