# -*- coding: utf-8 -*-
"""
CLI Script to Render Korean Audiobooks and Voice Previews
Powered by KrTtsEngine and FFmpeg.
"""

from __future__ import annotations

import os
import sys
import argparse
import asyncio
import logging
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from auto_yt.kr_tts_engine import KrTtsEngine, get_kr_tts_engine, DEFAULT_FEMALE_VOICE, DEFAULT_MALE_VOICE
from auto_yt.paths import PROJECT_ROOT

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("RenderKrAudioCLI")

OUTPUT_DRAMA_DIR = PROJECT_ROOT / "output_drama_kr"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Render High-Quality Korean Audiobooks from generated scripts"
    )
    parser.add_argument(
        "--slug",
        type=str,
        default="test_matrix_gobu",
        help="Story slug folder name in output_drama_kr/",
    )
    parser.add_argument(
        "--input-file",
        type=str,
        default=None,
        help="Direct path to a custom text file to synthesize",
    )
    parser.add_argument(
        "--sample-only",
        action="store_true",
        help="Synthesize only the first ~500 chars (approx 45s preview)",
    )
    parser.add_argument(
        "--voice",
        type=str,
        default=DEFAULT_FEMALE_VOICE,
        choices=[DEFAULT_FEMALE_VOICE, DEFAULT_MALE_VOICE, "ko-KR-HyunsuMultilingualNeural"],
        help="Microsoft Neural voice to use",
    )
    parser.add_argument(
        "--rate",
        type=str,
        default="+0%",
        help="Speaking rate adjustment (e.g. +0%, -5%, +5%)",
    )
    return parser.parse_args()


async def main():
    args = parse_args()
    engine = get_kr_tts_engine()

    # Xác định file kịch bản đầu vào
    if args.input_file:
        input_path = Path(args.input_file)
        target_dir = input_path.parent
    else:
        target_dir = OUTPUT_DRAMA_DIR / args.slug
        input_path = target_dir / "full_story_audiobook.txt"

    if not input_path.exists():
        print(f"❌ Không tìm thấy tệp kịch bản: {input_path}")
        sys.exit(1)

    raw_text = input_path.read_text(encoding="utf-8")

    print("=" * 70)
    print("🎙️ KOREAN AUDIO SYNTHESIS RUNNER")
    print(f"📁 Target Folder: {target_dir}")
    print(f"📄 Input Script:  {input_path.name} ({len(raw_text):,} characters)")
    print(f"🔊 Voice:         {args.voice} (Rate: {args.rate})")
    print(f"⚡ Mode:          {'Preview Sample (~45s)' if args.sample_only else 'Full Audiobook (60-90m)'}")
    print("=" * 70)

    if args.sample_only:
        # Lấy 3 đoạn đầu tiên (~500 ký tự)
        paragraphs = [p.strip() for p in raw_text.split("\n\n") if p.strip()]
        sample_text = "\n\n".join(paragraphs[:3])
        output_file = target_dir / "sample_preview.mp3"

        print(f"\n📝 Đang render đoạn mẫu ({len(sample_text)} ký tự)...")
        res = await engine.synthesize_text(
            text=sample_text,
            output_file=output_file,
            voice=args.voice,
            rate=args.rate,
            normalize_loudness=True,
        )

        print("\n" + "=" * 70)
        print("🎉 PREVIEW RENDER COMPLETED!")
        print(f"🎵 Output Audio:  {res['output_file']}")
        print(f"⏱️ Duration:      {res['duration_seconds']:.1f} seconds")
        print("=" * 70)

    else:
        output_file = target_dir / "full_story_voice.mp3"

        def _on_progress(completed: int, total: int):
            percent = (completed / total) * 100
            print(f"\r⏳ Tiến độ tổng hợp: {completed}/{total} chunks ({percent:.1f}%)", end="", flush=True)

        print("\n🚀 Bắt đầu render toàn bộ Audiobook dài...")
        res = await engine.synthesize_audiobook(
            text_or_file=input_path,
            output_file=output_file,
            voice=args.voice,
            rate=args.rate,
            progress_callback=_on_progress,
        )

        print("\n\n" + "=" * 70)
        print("🎉 FULL AUDIOBOOK COMPLETED SUCCESSFULLY!")
        print(f"🎵 Output Audio:   {res['output_file']}")
        print(f"⏱️ Total Duration: {res['duration_minutes']} minutes ({res['duration_seconds']:.1f}s)")
        print(f"📦 File Size:      {res['file_size_mb']} MB")
        print(f"🧩 Total Chunks:   {res['total_chunks']}")
        print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
