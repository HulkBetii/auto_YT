# -*- coding: utf-8 -*-
"""
STAGE 7C & STAGE 9: DETERMINISTIC LAYERED THUMBNAIL COMPOSITOR & REPAIR CLI
- Wraps stage7c_compositor.composite_layered_thumbnail
- Provides programmatic API and CLI entry points
- Renders project font: BeVietnamPro-Bold.ttf
- Preserves 100% Host identity by compositing real cutout assets
- Exports 100% publication-ready 'thumbnail_youtube.png' (1280x720, 16:9)
"""

import sys
import os
import argparse
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

WEB_VN_DIR = REPO_ROOT / "web_vn"
SCRIPTS_DIR = WEB_VN_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from thumbnail_pipeline.stage7c_compositor import (
    composite_layered_thumbnail,
    composite_vietnamese_thumbnail,
    get_vietnamese_bold_font,
    get_vietnamese_regular_font,
    fit_typography_lines,
    draw_text_with_outline_and_shadow,
    draw_attention_marker,
)

logger = logging.getLogger("thumbnail_compositor_cli")


def main():
    parser = argparse.ArgumentParser(description="Deterministic Layered Thumbnail Compositor")
    parser.add_argument("--scene", type=str, required=True, help="Path to drama scene raw image")
    parser.add_argument("--title", type=str, required=True, help="Headline text")
    parser.add_argument("--out", type=str, default=str(REPO_ROOT / "web_vn" / "output" / "thumbnail_youtube.png"))
    parser.add_argument("--host-pos", type=str, default="left", choices=["left", "right"])
    parser.add_argument("--host-emotion", type=str, default="serious")
    parser.add_argument("--text-zone", type=str, default="left")
    parser.add_argument("--badge", type=str, default="🎙️ SÂM KỂ CHUYỆN")
    parser.add_argument("--subtitle", type=str, default=None)

    args = parser.parse_args()

    host_profile = {
        "host_name": "Bác Sâm",
        "reference_path": str(WEB_VN_DIR / "data" / "thumbnail_assets" / "host" / "default" / "reference.webp"),
        "expressions": {
            "anger": str(WEB_VN_DIR / "data" / "thumbnail_assets" / "host" / "expressions" / "anger.png"),
            "disbelief": str(WEB_VN_DIR / "data" / "thumbnail_assets" / "host" / "expressions" / "disbelief.png"),
            "grief": str(WEB_VN_DIR / "data" / "thumbnail_assets" / "host" / "expressions" / "grief.png"),
            "serious": str(WEB_VN_DIR / "data" / "thumbnail_assets" / "host" / "expressions" / "serious.png"),
            "shock": str(WEB_VN_DIR / "data" / "thumbnail_assets" / "host" / "expressions" / "shock.png"),
            "suspicious": str(WEB_VN_DIR / "data" / "thumbnail_assets" / "host" / "expressions" / "suspicious.png"),
        }
    }

    out_path = composite_layered_thumbnail(
        drama_scene_path=Path(args.scene),
        title_text=args.title,
        output_thumb_path=Path(args.out),
        host_profile=host_profile,
        host_emotion=args.host_emotion,
        host_position=args.host_pos,
        badge_text=args.badge,
        subtitle_text=args.subtitle,
        text_zone=args.text_zone,
    )
    print(f"[OK] Composite saved to {out_path}")


if __name__ == "__main__":
    main()
