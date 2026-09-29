# -*- coding: utf-8 -*-
"""
KOREAN YOUTUBE THUMBNAIL GENERATOR (사연만남 Broadcast Style)
High-CTR 1280x720 Thumbnail Generator with Bold Typography, Multi-Layer Gradient Overlays,
and YouTube Safe Zone Alignment.

Features:
- High-contrast Korean Typography using Windows Native Malgun Gothic Bold (malgunbd.ttf).
- Text outline (stroke) + drop shadow + highlight color accents (Yellow, White, Crimson).
- Dark cinematic vignette and drama atmosphere styling.
- Safe zone preservation (avoids YouTube's 00:00 timestamp box at bottom-right).
- Badge tags (e.g., [사연라디오], [역대급 반전], [결말포함]).
"""

from __future__ import annotations

import os
import math
import logging
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

from auto_yt.paths import DATA_DIR, PROJECT_ROOT

logger = logging.getLogger("KrThumbnailGenerator")

DEFAULT_FONT_PATH = Path("C:/Windows/Fonts/malgunbd.ttf")
FALLBACK_FONT_PATH = Path("C:/Windows/Fonts/malgun.ttf")


def get_korean_font(size: int) -> ImageFont.FreeTypeFont:
    """Tải font tiếng Hàn hỗ trợ đầy đủ ký tự Hangul."""
    if DEFAULT_FONT_PATH.exists():
        try:
            return ImageFont.truetype(str(DEFAULT_FONT_PATH), size)
        except Exception:
            pass
    if FALLBACK_FONT_PATH.exists():
        try:
            return ImageFont.truetype(str(FALLBACK_FONT_PATH), size)
        except Exception:
            pass
    return ImageFont.load_default()


def create_cinematic_backdrop(
    width: int = 1280,
    height: int = 720,
    base_image_path: Optional[Path] = None,
    mood_color: str = "dark_dramatic",
) -> Image.Image:
    """
    Tạo ảnh nền điện ảnh kịch tính (1280x720) với hiệu ứng Vignette và lớp phủ tối
    để làm nổi bật chữ tiếng Hàn độ tương phản cao.
    """
    if base_image_path and base_image_path.exists():
        try:
            bg = Image.open(str(base_image_path)).convert("RGB")
            bg = bg.resize((width, height), Image.Resampling.LANCZOS)
            # Giảm sáng và tăng độ tương phản để chữ đọc rõ
            enhancer = ImageEnhance.Brightness(bg)
            bg = enhancer.enhance(0.45)
            contrast_enhancer = ImageEnhance.Contrast(bg)
            bg = contrast_enhancer.enhance(1.25)
        except Exception as e:
            logger.warning(f"Lỗi mở ảnh nền {base_image_path}: {e}. Dùng nền gradient mặc định.")
            bg = None
    else:
        bg = None

    if bg is None:
        # Tạo nền gradient tối điện ảnh (Deep Navy / Midnight Charcoal / Crimson Tint)
        bg = Image.new("RGB", (width, height), (15, 18, 28))
        draw = ImageDraw.Draw(bg)
        
        # Vẽ dải màu gradient dọc
        for y in range(height):
            ratio = y / float(height)
            if mood_color == "dark_crimson":
                r = int(35 * (1 - ratio) + 12 * ratio)
                g = int(12 * (1 - ratio) + 8 * ratio)
                b = int(22 * (1 - ratio) + 16 * ratio)
            else:  # dark_dramatic navy/charcoal
                r = int(18 * (1 - ratio) + 8 * ratio)
                g = int(24 * (1 - ratio) + 12 * ratio)
                b = int(42 * (1 - ratio) + 20 * ratio)
            draw.line([(0, y), (width, y)], fill=(r, g, b))

    # Thêm lớp phủ tối bên trái và bên trên (Vignette) để đặt tiêu đề nổi bật
    vignette = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    v_draw = ImageDraw.Draw(vignette)

    # Gradient tối từ trái sang phải (độ mờ giảm dần)
    for x in range(int(width * 0.75)):
        alpha = int(190 * (1.0 - (x / (width * 0.75)) ** 1.3))
        v_draw.line([(x, 0), (x, height)], fill=(0, 0, 0, alpha))

    # Gradient tối trên và dưới
    for y in range(int(height * 0.4)):
        alpha_top = int(130 * (1.0 - (y / (height * 0.4))))
        v_draw.line([(0, y), (width, y)], fill=(0, 0, 0, alpha_top))
        alpha_bot = int(160 * (1.0 - (y / (height * 0.4))))
        v_draw.line([(0, height - 1 - y), (width, height - 1 - y)], fill=(0, 0, 0, alpha_bot))

    # Ghép lớp phủ vào nền
    bg_rgba = bg.convert("RGBA")
    combined = Image.alpha_composite(bg_rgba, vignette)
    return combined.convert("RGB")


def draw_text_with_outline_and_shadow(
    draw: ImageDraw.ImageDraw,
    position: Tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill_color: str | Tuple[int, int, int],
    outline_color: str | Tuple[int, int, int] = "#000000",
    outline_width: int = 5,
    shadow_offset: Tuple[int, int] = (6, 6),
    shadow_color: Tuple[int, int, int, int] = (0, 0, 0, 230),
) -> None:
    """
    Vẽ chữ tiếng Hàn với hiệu ứng đổ bóng sâu (drop shadow) và viền nét đen dày (stroke)
    đảm bảo nổi bật 100% trên mọi nền ảnh theo chuẩn thumbnail YouTube triệu view.
    """
    x, y = position

    # 1. Vẽ bóng đổ (Shadow)
    sx, sy = shadow_offset
    for dx in range(-outline_width, outline_width + 1):
        for dy in range(-outline_width, outline_width + 1):
            draw.text((x + sx + dx, y + sy + dy), text, font=font, fill=(0, 0, 0, 200))

    # 2. Vẽ viền nét (Outline/Stroke)
    for dx in range(-outline_width, outline_width + 1):
        for dy in range(-outline_width, outline_width + 1):
            if dx * dx + dy * dy <= outline_width * outline_width:
                draw.text((x + dx, y + dy), text, font=font, fill=outline_color)

    # 3. Vẽ chữ chính
    draw.text((x, y), text, font=font, fill=fill_color)


def draw_badge(
    image: Image.Image,
    position: Tuple[int, int],
    badge_text: str,
    bg_color: Tuple[int, int, int] = (220, 38, 38),  # Crimson Red
    text_color: Tuple[int, int, int] = (255, 255, 255),
    font_size: int = 28,
    padding: Tuple[int, int] = (16, 6),
    corner_radius: int = 8,
) -> Image.Image:
    """Vẽ tag badge bo góc (e.g. [사연라디오], [역대급 반전])."""
    font = get_korean_font(font_size)
    
    # Đo kích thước text
    dummy_img = Image.new("RGBA", (1, 1))
    dummy_draw = ImageDraw.Draw(dummy_img)
    bbox = dummy_draw.textbbox((0, 0), badge_text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    px, py = padding
    box_w = tw + px * 2
    box_h = th + py * 2

    x, y = position

    # Vẽ badge trên layer trong suốt
    badge_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    b_draw = ImageDraw.Draw(badge_layer)

    # Đổ bóng nhẹ cho badge
    b_draw.rounded_rectangle(
        [(x + 3, y + 3), (x + box_w + 3, y + box_h + 3)],
        radius=corner_radius,
        fill=(0, 0, 0, 160),
    )

    # Vẽ hộp badge chính
    b_draw.rounded_rectangle(
        [(x, y), (x + box_w, y + box_h)],
        radius=corner_radius,
        fill=(*bg_color, 255),
    )

    # Vẽ viền trắng mỏng cho badge
    b_draw.rounded_rectangle(
        [(x, y), (x + box_w, y + box_h)],
        radius=corner_radius,
        outline=(255, 255, 255, 180),
        width=2,
    )

    # Vẽ text
    b_draw.text(
        (x + px, y + py - 2),
        badge_text,
        font=font,
        fill=(*text_color, 255),
    )

    combined = Image.alpha_composite(image.convert("RGBA"), badge_layer)
    return combined.convert("RGB")


class KrThumbnailGenerator:
    """
    Engine tạo Thumbnail YouTube tiếng Hàn chuẩn phát thanh 사연만남.
    """

    def __init__(self, output_width: int = 1280, output_height: int = 720):
        self.width = output_width
        self.height = output_height

    def generate_thumbnail(
        self,
        main_hook_1: str,
        main_hook_2: str,
        sub_hook: Optional[str] = None,
        badge_text: str = "사연라디오",
        base_image_path: Optional[Path] = None,
        output_path: Optional[Path] = None,
        accent_color: str = "yellow",
    ) -> Image.Image:
        """
        Tạo ảnh thumbnail 1280x720 hoàn chỉnh.
        
        Args:
            main_hook_1: Dòng tiêu đề chính 1 (e.g. '"피 한 방울 안 섞였다고?"')
            main_hook_2: Dòng tiêu đề chính 2 (e.g. '50억 통장의 비밀')
            sub_hook: Dòng phụ chú giải (e.g. '3년 뒤 무릎 꿇은 시모')
            badge_text: Nhãn góc trên (e.g. '사연라디오', '결말포함')
            base_image_path: Đường dẫn ảnh nền gốc nếu có
            output_path: Nơi lưu ảnh (.png / .jpg)
            accent_color: Màu nhấn ('yellow', 'red', 'cyan')
        """
        # 1. Tạo nền điện ảnh
        image = create_cinematic_backdrop(
            width=self.width,
            height=self.height,
            base_image_path=base_image_path,
        )

        # 2. Vẽ Badge góc trên bên trái
        if badge_text:
            image = draw_badge(
                image=image,
                position=(50, 42),
                badge_text=badge_text,
                bg_color=(220, 38, 38),  # Đỏ nổi bật
                text_color=(255, 255, 255),
                font_size=28,
            )

        draw = ImageDraw.Draw(image)

        # Font chữ lớn tương phản cao
        font_hook_1 = get_korean_font(72)
        font_hook_2 = get_korean_font(78)
        font_sub = get_korean_font(46)

        start_y = 115

        # 3. Vẽ Main Hook 1 (Trắng hoặc Vàng nhạt)
        color_1 = "#FFFFFF"
        draw_text_with_outline_and_shadow(
            draw=draw,
            position=(50, start_y),
            text=main_hook_1,
            font=font_hook_1,
            fill_color=color_1,
            outline_color="#000000",
            outline_width=6,
            shadow_offset=(7, 7),
        )

        # 4. Vẽ Main Hook 2 (Vàng rực hoặc Đỏ cam nhấn mạnh)
        color_2 = "#FFE600" if accent_color == "yellow" else "#FF4B4B"
        draw_text_with_outline_and_shadow(
            draw=draw,
            position=(50, start_y + 105),
            text=main_hook_2,
            font=font_hook_2,
            fill_color=color_2,
            outline_color="#000000",
            outline_width=7,
            shadow_offset=(8, 8),
        )

        # 5. Vẽ Sub-hook (nếu có)
        if sub_hook:
            draw_text_with_outline_and_shadow(
                draw=draw,
                position=(50, start_y + 225),
                text=f"▶ {sub_hook}",
                font=font_sub,
                fill_color="#00E5FF",  # Neon Cyan nổi bật
                outline_color="#000000",
                outline_width=5,
                shadow_offset=(5, 5),
            )

        # 6. Thêm khung viền đen mỏng sang trọng quanh thumbnail
        draw.rectangle([(0, 0), (self.width - 1, self.height - 1)], outline=(0, 0, 0), width=4)

        if output_path:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            # Lưu cả chất lượng tối đa
            if str(output_path).lower().endswith(".jpg") or str(output_path).lower().endswith(".jpeg"):
                image.save(str(output_path), "JPEG", quality=95)
            else:
                image.save(str(output_path), "PNG")
            logger.info(f"✅ Đã xuất Thumbnail YouTube: {output_path} ({self.width}x{self.height})")

        return image
