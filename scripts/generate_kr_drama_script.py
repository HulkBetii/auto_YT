# -*- coding: utf-8 -*-
"""
CLI Script to Generate Highest Quality Korean Radio Drama / Sayeon Audiobook Scripts
Powered by 9Router Gemini API Gateway, 4D Topic Matrix, and DramaKrPipeline.
"""

from __future__ import annotations

import sys
import argparse
import asyncio
import logging
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from auto_yt.drama_kr_pipeline import DramaKrPipeline, TOPIC_CLUSTERS
from auto_yt.kr_topic_matrix import (
    KrTopicMatrix,
    KrTopicRegistry,
    get_kr_topic_registry,
    RELATIONSHIPS,
    CATALYSTS,
    REVERSALS,
    EMOTIONAL_TONES,
)
from auto_yt.gemini_api_engine import get_gemini_api_engine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("GenerateKrDramaCLI")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate High-Quality Korean Radio Drama Scripts for YouTube (사연만남 Style)"
    )
    # 4D Matrix flags
    parser.add_argument(
        "--matrix",
        action="store_true",
        help="Generate story using a fresh, non-repeating combo from the 4D Topic Matrix (720 unique combos)",
    )
    parser.add_argument(
        "--matrix-status",
        action="store_true",
        help="Show 4D Topic Matrix space coverage and statistics",
    )
    parser.add_argument(
        "--rel",
        type=str,
        default=None,
        choices=list(RELATIONSHIPS.keys()),
        help="Filter matrix by specific Relationship axis",
    )
    parser.add_argument(
        "--cat",
        type=str,
        default=None,
        choices=list(CATALYSTS.keys()),
        help="Filter matrix by specific Catalyst/Setting axis",
    )
    parser.add_argument(
        "--rev",
        type=str,
        default=None,
        choices=list(REVERSALS.keys()),
        help="Filter matrix by specific Reversal mechanism axis",
    )
    parser.add_argument(
        "--tone",
        type=str,
        default=None,
        choices=list(EMOTIONAL_TONES.keys()),
        help="Filter matrix by specific Emotional Tone axis",
    )

    # Legacy/Manual cluster flags
    parser.add_argument(
        "--cluster",
        type=str,
        default="cluster_kr_stepfamily",
        choices=list(TOPIC_CLUSTERS.keys()),
        help="Topic cluster ID from TOPIC_CLUSTERS (used when not in --matrix mode)",
    )
    parser.add_argument(
        "--custom-prompt",
        type=str,
        default="",
        help="Optional custom situation, twist, or character requirements",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="ag/gemini-3.8-flash-medium",
        help="9Router model name to use",
    )
    parser.add_argument(
        "--slug",
        type=str,
        default="",
        help="Custom story slug/folder name",
    )
    parser.add_argument(
        "--test-run",
        action="store_true",
        help="Run in test mode (fast check)",
    )
    return parser.parse_args()


async def main():
    args = parse_args()
    registry = get_kr_topic_registry()

    # If --matrix-status requested, print and exit
    if args.matrix_status:
        coverage = registry.get_matrix_coverage()
        print("=" * 70)
        print("📊 4D K-DRAMA TOPIC MATRIX STATUS REPORT")
        print("=" * 70)
        print(f"🌌 Total Matrix Combinations: {coverage['total_space']:,} unique storylines")
        print(f"✅ Used Combos in Registry:   {coverage['used_count']:,}")
        print(f"⏳ Remaining Fresh Combos:    {coverage['remaining_count']:,}")
        print(f"📈 Space Coverage:            {coverage['coverage_percentage']}")
        print(f"🕒 Last Updated:              {coverage['last_updated']}")
        print("-" * 70)
        print("📐 AXES BREAKDOWN:")
        print(f"  • Relationships (8):    {', '.join(RELATIONSHIPS.keys())}")
        print(f"  • Catalysts (6):        {', '.join(CATALYSTS.keys())}")
        print(f"  • Reversals (5):        {', '.join(REVERSALS.keys())}")
        print(f"  • Emotional Tones (3):  {', '.join(EMOTIONAL_TONES.keys())}")
        print("=" * 70)
        return

    print("=" * 70)
    print("🇰🇷 KOREAN RADIO DRAMA (사연만남 CLONE) SCRIPT GENERATOR")
    print(f"🤖 Model: {args.model}")

    matrix_combo = None
    if args.matrix or args.rel or args.cat or args.rev or args.tone:
        matrix_combo = registry.get_next_fresh_combo(
            filter_rel=args.rel,
            filter_cat=args.cat,
            filter_rev=args.rev,
            filter_tone=args.tone,
        )
        print(f"🎲 Mode: 4D TOPIC MATRIX (Hash: {matrix_combo['combo_hash']})")
        print(f"  👥 Relationship: {matrix_combo['rel_name']}")
        print(f"  ⚡ Catalyst:     {matrix_combo['cat_name']}")
        print(f"  🔄 Reversal:     {matrix_combo['rev_name']}")
        print(f"  🎭 Tone:         {matrix_combo['tone_name']}")
    else:
        print(f"📌 Mode: Manual Cluster ({args.cluster} - {TOPIC_CLUSTERS[args.cluster]['name']})")
    print("=" * 70)

    engine = get_gemini_api_engine(default_model=args.model)
    pipeline = DramaKrPipeline(engine=engine, model=args.model)

    slug = args.slug or (
        f"demo_matrix_{matrix_combo['combo_hash'][:8]}"
        if matrix_combo and args.test_run
        else (f"demo_{args.cluster}" if args.test_run else None)
    )

    try:
        result = await pipeline.generate_story(
            matrix_combo=matrix_combo,
            cluster_id=args.cluster if not matrix_combo else None,
            custom_prompt=args.custom_prompt,
            story_slug=slug,
        )

        print("\n" + "=" * 70)
        print("🎉 GENERATION COMPLETED SUCCESSFULLY!")
        print(f"📁 Output Directory: {result['output_dir']}")
        print(f"📊 Total Words: {result['metrics']['word_count']:,} Korean words")
        print(f"📊 Total Characters (no space): {result['metrics']['char_count_no_space']:,}")
        print(f"⏱️ Estimated Audio Duration: ~{result['metrics']['estimated_audio_minutes']} minutes")
        print(f"🎙️ Clean Audiobook Text: {result['files']['audiobook_clean']}")
        print(f"🎭 Multi-voice Script: {result['files']['multivoice_script']}")
        print(f"🏷️ SEO Package: {result['files']['seo_package']}")
        if result.get("combo_hash"):
            print(f"🔑 Combo Hash Registered: {result['combo_hash']}")
        print("=" * 70)

    except Exception as e:
        logger.error(f"❌ Generation failed with error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
