# -*- coding: utf-8 -*-
"""
Unit tests for Korean YouTube Video, Thumbnail, and Metadata Generation Modules.
"""

import os
import json
import pytest
from pathlib import Path
from PIL import Image

from auto_yt.kr_thumbnail_generator import KrThumbnailGenerator, get_korean_font
from auto_yt.kr_video_renderer import KrVideoRenderer, get_media_duration
from auto_yt.kr_metadata_builder import build_youtube_upload_kit


def test_korean_font_loader():
    """Kiểm tra font tiếng Hàn được nạp thành công."""
    font = get_korean_font(36)
    assert font is not None


def test_kr_thumbnail_generator(tmp_path: Path):
    """Kiểm tra xuất ảnh Thumbnail YouTube 1280x720."""
    gen = KrThumbnailGenerator()
    out_png = tmp_path / "test_thumb.png"
    out_jpg = tmp_path / "test_thumb.jpg"

    img = gen.generate_thumbnail(
        main_hook_1="피 한 방울 안 섞였다고?",
        main_hook_2="50억 통장의 비밀",
        sub_hook="3년 뒤 무릎 꿇은 시모",
        badge_text="사연라디오",
        output_path=out_png,
    )

    assert out_png.exists()
    assert out_png.stat().st_size > 5000

    img_loaded = Image.open(out_png)
    assert img_loaded.size == (1280, 720)

    gen.generate_thumbnail(
        main_hook_1="피 한 방울 안 섞였다고?",
        main_hook_2="50억 통장의 비밀",
        output_path=out_jpg,
    )
    assert out_jpg.exists()


def test_kr_metadata_builder(tmp_path: Path):
    """Kiểm tra việc tạo file youtube_upload_kit.txt từ SEO package markdown."""
    sample_seo_md = tmp_path / "stage8_youtube_seo_package.md"
    sample_seo_md.write_text(
        """# 1. 유튜브 클릭률(CTR) 극대화 제목
* **옵션 1 (복수·사이다형 - 추천):**
  > **"피 한 방울 안 섞인 년이 어디서!" 내쫓던 시모의 최후 [사연라디오]**
* **옵션 2:**
  > **50억 유언장의 충격적 진실**

### [첫 3줄 강력한 텍스트 훅]
> 30년을 친딸처럼 모셨던 시어머니가 버린 날.
> 10년 뒤 휠체어를 타고 나타났습니다.

### [챕터 타임스탬프 (Chapter Timestamps)]
* `00:00` 오프닝 : 피눈물로 시작된 서막
* `10:00` 1장 : 30년 헌신의 대가

# 4. 유튜브 SEO 핵심 태그
`사연라디오`, `오디오드라마`, `고부갈등`, `사이다사연`
""",
        encoding="utf-8",
    )

    meta = build_youtube_upload_kit(tmp_path, actual_audio_duration_s=120.0)
    assert meta["title"] == '"피 한 방울 안 섞인 년이 어디서!" 내쫓던 시모의 최후 [사연라디오]'
    assert len(meta["tags"]) >= 4

    kit_txt = tmp_path / "youtube_upload_kit.txt"
    assert kit_txt.exists()
    assert "YOUTUBE UPLOAD KIT" in kit_txt.read_text(encoding="utf-8")


def test_kr_video_renderer_components():
    """Kiểm tra khởi tạo engine render video và phát hiện công cụ."""
    renderer = KrVideoRenderer()
    assert renderer.ffmpeg_bin is not None
    assert renderer.ffprobe_bin is not None
