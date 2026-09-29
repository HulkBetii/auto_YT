# -*- coding: utf-8 -*-
"""
Fast GPU NVENC Video Renderer & Cover Generator for Vietnamese Audio Drama
Renders full 1080p MP4 from Master Audio + Atmospheric Cover Image.
"""

import os
import sys
import subprocess
import logging
from pathlib import Path
from typing import Optional
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("video_renderer")

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "web_vn" / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from audio_mixer import get_ffmpeg_bin


def generate_story_cover_image(
    title: str,
    output_image_path: Path,
    subtitle: Optional[str] = "Truyện Ngắn Đa Vai • VieNeu-TTS 48kHz Broadcast Master",
    badge: Optional[str] = "🎙️ SÂM KỂ CHUYỆN — AUDIO DRAMA"
) -> Path:
    """
    Generates a 1920x1080 dark cinematic cover image for YouTube / MP4 video.
    """
    output_image_path.parent.mkdir(parents=True, exist_ok=True)
    width, height = 1920, 1080

    # Base image with subtle dark cinematic gradient
    img = Image.new("RGB", (width, height), color=(14, 16, 22))
    draw = ImageDraw.Draw(img)

    for y in range(height):
        ratio = y / height
        r = int(12 + ratio * 18)
        g = int(14 + ratio * 12)
        b = int(24 + ratio * 20)
        draw.line([(0, y), (width, y)], fill=(r, g, b))

    # Decorative inner golden/amber border
    margin = 40
    draw.rectangle(
        [(margin, margin), (width - margin, height - margin)],
        outline=(212, 175, 55),
        width=3
    )
    draw.rectangle(
        [(margin + 10, margin + 10), (width - margin - 10, height - margin - 10)],
        outline=(60, 65, 80),
        width=1
    )

    # Load system fonts safely
    def load_font(font_names: list, size: int):
        for name in font_names:
            try:
                return ImageFont.truetype(name, size)
            except Exception:
                continue
        return ImageFont.load_default()

    font_badge = load_font(["arialbd.ttf", "segoeuib.ttf"], 36)
    font_title = load_font(["arialbd.ttf", "segoeuib.ttf", "timesbd.ttf"], 54)
    font_sub = load_font(["arial.ttf", "segoeui.ttf"], 32)
    font_footer = load_font(["arial.ttf", "segoeui.ttf"], 24)

    # Top Badge Box
    badge_text = badge.upper()
    badge_box = draw.textbbox((0, 0), badge_text, font=font_badge)
    badge_w = badge_box[2] - badge_box[0]
    badge_x = (width - badge_w) // 2
    badge_y = 120

    # Draw badge background pill
    draw.rounded_rectangle(
        [(badge_x - 30, badge_y - 12), (badge_x + badge_w + 30, badge_y + 50)],
        radius=25,
        fill=(35, 40, 58),
        outline=(212, 175, 55),
        width=2
    )
    draw.text((badge_x, badge_y), badge_text, font=font_badge, fill=(245, 215, 110))

    # Wrapped Title
    # Break long title into lines (max ~40 chars per line)
    words = title.split()
    lines = []
    current_line = []
    for w in words:
        current_line.append(w)
        if len(" ".join(current_line)) > 38:
            lines.append(" ".join(current_line))
            current_line = []
    if current_line:
        lines.append(" ".join(current_line))

    # Center title vertically in middle section
    total_title_h = len(lines) * 75
    start_y = 420 - (total_title_h // 2)

    for i, line in enumerate(lines):
        line_box = draw.textbbox((0, 0), line, font=font_title)
        lw = line_box[2] - line_box[0]
        lx = (width - lw) // 2
        ly = start_y + i * 75
        # Shadow effect
        draw.text((lx + 3, ly + 3), line, font=font_title, fill=(5, 5, 10))
        draw.text((lx, ly), line, font=font_title, fill=(255, 255, 255))

    # Subtitle
    if subtitle:
        sub_box = draw.textbbox((0, 0), subtitle, font=font_sub)
        sub_w = sub_box[2] - sub_box[0]
        sub_x = (width - sub_w) // 2
        sub_y = start_y + total_title_h + 50
        draw.text((sub_x, sub_y), subtitle, font=font_sub, fill=(180, 195, 215))

    # Footer
    footer_text = "AUTO_YT PRODUCTION • 48KHZ STEREO BROADCAST MASTER • BÁC SÂM KỂ CHUYỆN"
    foot_box = draw.textbbox((0, 0), footer_text, font=font_footer)
    foot_w = foot_box[2] - foot_box[0]
    draw.text(((width - foot_w) // 2, height - 100), footer_text, font=font_footer, fill=(110, 120, 140))

    img.save(str(output_image_path), quality=95)
    logger.info(f"Generated story cover image: {output_image_path}")
    return output_image_path


def render_story_video(
    image_path: Path,
    audio_path: Path,
    output_path: Path,
    use_gpu: bool = True
) -> bool:
    """
    Renders 1080p MP4 from cover image and master audio using NVENC GPU encoder.
    """
    if not image_path.exists():
        logger.error(f"Cover image not found: {image_path}")
        return False
    if not audio_path.exists():
        logger.error(f"Audio file not found: {audio_path}")
        return False

    output_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg_bin = get_ffmpeg_bin()

    vcodec = "h264_nvenc" if use_gpu else "libx264"
    preset = "p4" if use_gpu else "ultrafast"

    cmd = [
        ffmpeg_bin, "-y",
        "-loop", "1", "-i", str(image_path),
        "-i", str(audio_path),
        "-c:v", vcodec,
        "-preset", preset,
        "-b:v", "3M",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        str(output_path)
    ]

    logger.info(f"Rendering video with [{vcodec}] -> {output_path}...")
    try:
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            file_size = output_path.stat().st_size
            logger.info(f"✅ Video successfully rendered: {output_path} ({file_size:,} bytes)")
            return True
        else:
            logger.warning(f"NVENC render failed ({res.stderr[:200]}). Falling back to libx264 CPU...")
            cmd[6] = "libx264"
            cmd[8] = "ultrafast"
            res_cpu = subprocess.run(cmd, capture_output=True, text=True)
            if res_cpu.returncode == 0:
                logger.info(f"✅ Video successfully rendered with CPU: {output_path}")
                return True
            else:
                logger.error(f"CPU Render failed: {res_cpu.stderr[:300]}")
                return False
    except Exception as e:
        logger.error(f"Video rendering exception: {e}", exc_info=True)
        return False


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Render Story MP4 Video")
    parser.add_argument("--image", type=str, required=True, help="Path to cover image")
    parser.add_argument("--audio", type=str, required=True, help="Path to audio file (MP3/WAV)")
    parser.add_argument("--output", type=str, required=True, help="Path to output MP4 file")
    parser.add_argument("--cpu", action="store_true", help="Force CPU libx264 rendering")
    args = parser.parse_args()

    success = render_story_video(
        image_path=Path(args.image),
        audio_path=Path(args.audio),
        output_path=Path(args.output),
        use_gpu=not args.cpu
    )
    sys.exit(0 if success else 1)
