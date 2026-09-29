# -*- coding: utf-8 -*-
"""
CLI Script to Generate Highest Quality Korean Radio Drama / Sayeon Audiobook Scripts
Powered by 9Router Gemini API Gateway and DramaKrPipeline.
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
    parser.add_argument(
        "--cluster",
        type=str,
        default="cluster_kr_stepfamily",
        choices=list(TOPIC_CLUSTERS.keys()),
        help="Topic cluster ID from TOPIC_CLUSTERS",
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
    
    print("=" * 70)
    print("🇰🇷 KOREAN RADIO DRAMA (사연만남 CLONE) SCRIPT GENERATOR")
    print(f"📌 Cluster: {args.cluster} ({TOPIC_CLUSTERS[args.cluster]['name']})")
    print(f"🤖 Model: {args.model}")
    print("=" * 70)

    engine = get_gemini_api_engine(default_model=args.model)
    pipeline = DramaKrPipeline(engine=engine, model=args.model)

    seed = {
        "cluster_id": args.cluster,
        "title": TOPIC_CLUSTERS[args.cluster]["sample_titles"][0],
        "summary": TOPIC_CLUSTERS[args.cluster]["description"],
        "custom_prompt": args.custom_prompt,
    }

    slug = args.slug or (f"demo_{args.cluster}" if args.test_run else None)

    try:
        result = await pipeline.generate_story(
            topic_seed=seed,
            cluster_id=args.cluster,
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
        print("=" * 70)

    except Exception as e:
        logger.error(f"❌ Generation failed with error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
