# -*- coding: utf-8 -*-
"""
MASTER 1-CLICK PRODUCTION PIPELINE: KOREAN RADIO DRAMA (사연만남 Clone)
Executes end-to-end automated YouTube episode creation:
1. 4D Combinatorial Topic Matrix Seed
2. 8-Stage Hierarchical Korean Script Generator (ag/gemini-3.8-flash-high)
3. Broadcast-Grade Lossless TTS Narration (ko-KR-SunHiNeural, EBU R128 -16 LUFS, Pure Vocal)
4. High-CTR 1280x720 YouTube Thumbnail (Bold Malgun Gothic Typography & Badges)
5. 1080p Full HD MP4 Video Renderer (NVIDIA NVENC HW Acceleration + Dynamic Waveform)
6. Complete YouTube SEO Upload Kit (Title, Timestamps/Chapters, 30 Tags, Description)

Usage:
    # 1. Render complete video for an existing episode:
    python scripts/run_full_drama_kr.py --story-dir output_drama_kr/test_matrix_gobu

    # 2. Generate and produce a brand new episode from scratch:
    python scripts/run_full_drama_kr.py --matrix
"""

from __future__ import annotations

import sys
import os
import re
import json
import time
import argparse
import asyncio
import logging
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from auto_yt.drama_kr_pipeline import DramaKrPipeline
from auto_yt.kr_tts_engine import KrTtsEngine
from auto_yt.kr_thumbnail_generator import KrThumbnailGenerator
from auto_yt.kr_video_renderer import KrVideoRenderer, get_media_duration
from auto_yt.kr_metadata_builder import build_youtube_upload_kit
from auto_yt.kr_topic_matrix import (
    KrTopicMatrix,
    KrTopicRegistry,
    get_kr_topic_registry,
    RELATIONSHIPS,
    CATALYSTS,
    REVERSALS,
    EMOTIONAL_TONES,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("MasterDramaKr")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Master 1-Click Korean Radio Drama YouTube Production Pipeline"
    )
    parser.add_argument(
        "--story-dir",
        type=str,
        default=None,
        help="Path to an existing episode folder (skips script generation)",
    )
    parser.add_argument(
        "--matrix",
        action="store_true",
        help="Generate a fresh story from the 4D Topic Matrix (720 unique combos)",
    )
    parser.add_argument(
        "--rel",
        type=str,
        default=None,
        choices=list(RELATIONSHIPS.keys()),
        help="Filter matrix by Relationship axis",
    )
    parser.add_argument(
        "--cat",
        type=str,
        default=None,
        choices=list(CATALYSTS.keys()),
        help="Filter matrix by Catalyst/Setting axis",
    )
    parser.add_argument(
        "--rev",
        type=str,
        default=None,
        choices=list(REVERSALS.keys()),
        help="Filter matrix by Reversal axis",
    )
    parser.add_argument(
        "--tone",
        type=str,
        default=None,
        choices=list(EMOTIONAL_TONES.keys()),
        help="Filter matrix by Emotional Tone axis",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="ag/gemini-3.8-flash-high",
        help="9Router model name (default: ag/gemini-3.8-flash-high)",
    )
    parser.add_argument(
        "--rate",
        type=str,
        default="-3%",
        help="TTS speaking rate (default: -3% for dramatic pacing)",
    )
    parser.add_argument(
        "--pitch",
        type=str,
        default="-1Hz",
        help="TTS voice pitch (default: -1Hz)",
    )
    parser.add_argument(
        "--preview-only",
        action="store_true",
        help="Render a 30-second preview video instead of the full audio length",
    )
    parser.add_argument(
        "--skip-tts",
        action="store_true",
        help="Skip TTS synthesis if full_story_voice.mp3 already exists",
    )
    parser.add_argument(
        "--skip-video",
        action="store_true",
        help="Skip video render",
    )
    return parser.parse_args()


async def main():
    args = parse_args()
    t_start = time.time()

    print("=" * 80)
    print("🎬 MASTER 1-CLICK YOUTUBE PRODUCTION PIPELINE: KOREAN RADIO DRAMA")
    print(f"Primary AI Engine: {args.model} | HW Acceleration: NVIDIA NVENC (RTX 3060)")
    print("=" * 80)

    # -------------------------------------------------------------------------
    # GIAI ĐOẠN 1: Xác định / Tạo Kịch bản (Script Generation)
    # -------------------------------------------------------------------------
    if args.story_dir:
        story_dir = Path(args.story_dir).resolve()
        if not story_dir.exists():
            raise FileNotFoundError(f"Story directory does not exist: {story_dir}")
        print(f"\n📂 [BƯỚC 1/5] Sử dụng kịch bản có sẵn tại: {story_dir.name}")
    else:
        print("\n📝 [BƯỚC 1/5] Khởi tạo kịch bản mới từ 4D Topic Matrix (720 Cốt truyện)...")
        pipeline = DramaKrPipeline(model=args.model)
        
        # Chọn chủ đề từ Matrix
        matrix = KrTopicMatrix()
        registry = get_kr_topic_registry()
        seed = registry.get_next_fresh_combo(
            matrix=matrix,
            rel_filter=args.rel,
            cat_filter=args.cat,
            rev_filter=args.rev,
            tone_filter=args.tone,
        )
        print(f"  • Selected Seed: [{seed['combo_id']}] {seed['title_seed']}")
        print(f"  • Core Conflict: {seed['conflict']}")
        print(f"  • Reversal Climax: {seed['reversal_climax']}")

        story_dir = await pipeline.generate_story_from_matrix_seed(
            seed=seed,
            registry=registry,
        )
        print(f"  ✅ Kịch bản 8 Hồi đã hoàn tất tại: {story_dir}")

    # Kiểm tra các tệp kịch bản cần thiết
    audiobook_txt_file = story_dir / "full_story_audiobook.txt"
    seo_pkg_file = story_dir / "stage8_youtube_seo_package.md"

    if not audiobook_txt_file.exists():
        raise FileNotFoundError(f"Missing audiobook text file: {audiobook_txt_file}")

    # -------------------------------------------------------------------------
    # GIAI ĐOẠN 2: Tổng hợp Âm thanh Phát thanh (Broadcast TTS)
    # -------------------------------------------------------------------------
    audio_file = story_dir / "full_story_voice.mp3"
    print("\n🎙️ [BƯỚC 2/5] Tổng hợp giọng đọc Radio Drama (ko-KR-SunHiNeural)...")

    if args.skip_tts and audio_file.exists():
        print(f"  ⏩ Bỏ qua TTS (--skip-tts): Đã có {audio_file.name} ({audio_file.stat().st_size / (1024*1024):.2f} MB)")
    else:
        tts_engine = KrTtsEngine()
        t_tts_start = time.time()
        res_tts = await tts_engine.synthesize_audiobook(
            text_or_file=audiobook_txt_file,
            output_file=audio_file,
            rate=args.rate,
            pitch=args.pitch,
            silence_between_paragraphs_s=0.38,
        )
        t_tts_elapsed = time.time() - t_tts_start
        print(
            f"  ✅ Audio rendered: {audio_file.name} | "
            f"Duration: {res_tts['duration_seconds']/60:.2f} min | "
            f"Size: {audio_file.stat().st_size / (1024*1024):.2f} MB | "
            f"Time: {t_tts_elapsed:.1f}s"
        )

    actual_duration = get_media_duration(audio_file)

    # -------------------------------------------------------------------------
    # GIAI ĐOẠN 3: Tạo Thumbnail YouTube Triệu View (High-CTR Thumbnail)
    # -------------------------------------------------------------------------
    print("\n🎨 [BƯỚC 3/5] Tạo Thumbnail YouTube 1280x720 độ tương phản cao...")
    thumb_gen = KrThumbnailGenerator()
    thumb_png = story_dir / "thumbnail.png"
    thumb_jpg = story_dir / "thumbnail.jpg"

    # Trích xuất Hook từ SEO package nếu có
    hook_1 = "피 한 방울 안 섞였다고?"
    hook_2 = "50억 통장의 비밀"
    sub_hook = "3년 뒤 무릎 꿇은 시모"

    if seo_pkg_file.exists():
        seo_content = seo_pkg_file.read_text(encoding="utf-8")
        h_match = re.findall(r'\d+\.\s*\*\*텍스트\s*\d+:\*\*\s*\*\*([^*]+)\*\*\s*/\s*\*\*([^*]+)\*\*', seo_content)
        if h_match:
            hook_1 = h_match[0][0].strip().strip('"')
            hook_2 = h_match[0][1].strip().strip('"')

    thumb_gen.generate_thumbnail(
        main_hook_1=hook_1,
        main_hook_2=hook_2,
        sub_hook=sub_hook,
        badge_text="사연라디오",
        output_path=thumb_png,
    )
    thumb_gen.generate_thumbnail(
        main_hook_1=hook_1,
        main_hook_2=hook_2,
        sub_hook=sub_hook,
        badge_text="사연라디오",
        output_path=thumb_jpg,
    )
    print(f"  ✅ Thumbnail PNG: {thumb_png.name} ({thumb_png.stat().st_size / 1024:.1f} KB)")
    print(f"  ✅ Thumbnail JPG: {thumb_jpg.name} ({thumb_jpg.stat().st_size / 1024:.1f} KB)")

    # -------------------------------------------------------------------------
    # GIAI ĐOẠN 4: Đóng gói Metadata & YouTube Upload Kit
    # -------------------------------------------------------------------------
    print("\n📦 [BƯỚC 4/5] Đóng gói YouTube Upload Kit (Title, Description, Tags, Chapters)...")
    metadata = build_youtube_upload_kit(
        story_dir=story_dir,
        actual_audio_duration_s=actual_duration,
    )
    upload_kit_path = story_dir / "youtube_upload_kit.txt"
    print(f"  ✅ Upload Kit đã tạo: {upload_kit_path.name}")
    print(f"  • Selected Title: {metadata['title']}")
    print(f"  • Total Tags: {len(metadata['tags'])}")
    print(f"  • Chapters: {len(metadata['chapters'])} mốc thời gian")

    # -------------------------------------------------------------------------
    # GIAI ĐOẠN 5: Render Video 1080p MP4 (FFmpeg + NVENC GPU)
    # -------------------------------------------------------------------------
    video_file = story_dir / "final_video_1080p.mp4"
    if args.skip_video:
        print("\n🎬 [BƯỚC 5/5] Bỏ qua Render Video (--skip-video).")
    else:
        print("\n🎬 [BƯỚC 5/5] Render Video 1080p 30fps Full HD (NVIDIA NVENC Hardware Accelerated)...")
        renderer = KrVideoRenderer(prefer_nvenc=True)
        dur_limit = 30.0 if args.preview_only else None
        
        t_vid_start = time.time()
        vid_res = renderer.render_audiobook_video(
            audio_path=audio_file,
            image_path=thumb_png,
            output_mp4=video_file,
            duration_limit_s=dur_limit,
            show_waveform=True,
            waveform_color="0x00E5FF@0.45",
        )
        t_vid_elapsed = time.time() - t_vid_start
        print(
            f"  ✅ Video rendered: {video_file.name} | "
            f"Duration: {vid_res['duration_minutes']} min | "
            f"Size: {vid_res['file_size_mb']} MB | "
            f"Encoder: {vid_res['encoder']} | "
            f"Render Time: {t_vid_elapsed:.1f}s"
        )

    # -------------------------------------------------------------------------
    # TỔNG KẾT BÁO CÁO SẢN XUẤT (Production Summary)
    # -------------------------------------------------------------------------
    total_pipeline_time = time.time() - t_start
    print("\n" + "=" * 80)
    print("🏆 HOÀN TẤT XUẤT BẢN VIDEO YOUTUBE ĐẦU TIÊN (READY TO UPLOAD)")
    print("=" * 80)
    print(f"📁 Thư mục gói phát hành: {story_dir}")
    print(f"🎬 Video MP4 1080p:       {video_file if not args.skip_video else 'Skipped'}")
    print(f"🎙️ Audio Master MP3:     {audio_file}")
    print(f"🎨 Thumbnail 1280x720:    {thumb_png}")
    print(f"📋 YouTube Upload Kit:    {upload_kit_path}")
    print(f"⏱️ Tổng thời gian chạy:   {total_pipeline_time:.1f} giây")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
