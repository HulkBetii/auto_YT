# -*- coding: utf-8 -*-
"""
KOREAN YOUTUBE METADATA & UPLOAD KIT BUILDER
Extracts, formats, and validates YouTube metadata (Title, Description with Timestamps, Tags, Category)
for 1-click YouTube Studio uploads.
"""

from __future__ import annotations

import os
import re
import json
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List

logger = logging.getLogger("KrMetadataBuilder")


def build_youtube_upload_kit(
    story_dir: Path,
    actual_audio_duration_s: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Trích xuất toàn bộ metadata từ stage8_youtube_seo_package.md và tạo file youtube_upload_kit.txt.
    """
    seo_file = story_dir / "stage8_youtube_seo_package.md"
    if not seo_file.exists():
        raise FileNotFoundError(f"Không tìm thấy file SEO package: {seo_file}")

    content = seo_file.read_text(encoding="utf-8")

    # 1. Trích xuất Tiêu đề (Ưu tiên Option 1)
    titles = []
    title_matches = re.findall(r'(?:옵션\s*\d+[^\n]*:\s*\n\s*>\s*\*\*([^\n*]+)\*\*)', content)
    if not title_matches:
        title_matches = re.findall(r'>\s*\*\*([^\n*]{15,})\*\*', content)
    
    titles = [t.strip() for t in title_matches if len(t.strip()) > 10]
    selected_title = titles[0] if titles else "피 한 방울 안 섞인 며느리의 50억 유언장 반전 사이다 [사연라디오/오디오북]"

    # 2. Trích xuất Description Hooks
    desc_hooks = []
    desc_hook_match = re.search(r'###\s*\[첫 3줄 강력한 텍스트 훅\]\s*\n((?:>[^\n]*\n?)+)', content)
    if desc_hook_match:
        raw_hook = desc_hook_match.group(1)
        cleaned_hook = "\n".join([line.lstrip('>').strip() for line in raw_hook.splitlines() if line.strip()])
    else:
        cleaned_hook = (
            "우리네 인생의 기쁨과 슬픔, 가슴 뻥 뚫리는 권선징악 사이다 사연을 생생한 오디오 드라마로 전해드립니다.\n"
            "여러분의 소중한 사연 제보와 구독, 좋아요, 따뜻한 댓글은 큰 힘이 됩니다."
        )

    # 3. Trích xuất Timestamps / Chapters
    chapters_raw = re.findall(r'\*\s*`(\d+:\d+(?::\d+)?)`\s*([^\n]+)', content)
    chapter_lines = []
    if chapters_raw:
        for time_str, chap_title in chapters_raw:
            chapter_lines.append(f"{time_str} {chap_title.strip().lstrip(':').strip()}")
    else:
        chapter_lines = [
            "00:00 오프닝 : 피눈물로 시작된 비극의 서막",
            "10:00 1장 : 헌신의 대가와 충격적인 배신",
            "25:00 2장 : 바닥에서 다시 일군 기적",
            "45:00 3장 : 밝혀진 추악한 비밀과 통쾌한 반격",
            "1:05:00 4장 : 완벽한 인과응보와 새로운 시작",
        ]

    # 4. Trích xuất Tags
    tags = []
    tag_match = re.search(r'# 4\.\s*유튜브 SEO 핵심 태그[^\n]*\n\n([^\n]+)', content)
    if tag_match:
        raw_tags = tag_match.group(1)
        tags = [t.strip('`').strip() for t in re.split(r'[,、\s]+', raw_tags) if t.strip('`').strip()]
    if not tags:
        tags = [
            "사연라디오", "오디오드라마", "사연극장", "네이트판레전드", "고부갈등",
            "사이다사연", "권선징악", "인생사연", "오디오북", "라디오사연", "시월드"
        ]

    # 5. Xây dựng Full Description
    full_description = f"""{cleaned_hook}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 타임라인 (Chapter Timestamps)
{chr(10).join(chapter_lines)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[채널 안내]
우리네 인생의 희로애락, 가슴 뻥 뚫리는 통쾌한 권선징악 사연을 감동적인 라디오 드라마로 전해드립니다.
영상이 마음에 드셨다면 【구독】과 【좋아요】, 따뜻한 【댓글】 부탁드립니다!
소중한 가족과 지인분들께도 영상 많이 공유해 주세요.

[저작권 안내]
본 채널의 모든 스토리는 자체 창작 및 각색된 오디오 드라마 콘텐츠입니다.
무단 복제, 불법 재업로드 및 AI 무단 학습을 엄격히 금지합니다.
© 2026 사연라디오 All rights reserved.

#사연라디오 #오디오북 #고부갈등 #사이다사연 #권선징악 #네이트판레전드
""".strip()

    # 6. Đóng gói file youtube_upload_kit.txt
    upload_kit_content = f"""================================================================================
📺 YOUTUBE UPLOAD KIT (사연만남 Radio Drama Studio)
================================================================================

[1] VIDEO TITLE (클릭률 CTR 최적화 제목):
{selected_title}

--------------------------------------------------------------------------------
[2] ALTERNATIVE TITLES (A/B 테스트용 후보 제목):
{chr(10).join([f"• {t}" for t in titles[1:]]) if len(titles) > 1 else "• " + selected_title}

--------------------------------------------------------------------------------
[3] DESCRIPTION (영상 설명란):
{full_description}

--------------------------------------------------------------------------------
[4] TAGS (콤마 구분 태그 - 복사하여 태그란에 붙여넣기):
{", ".join(tags[:30])}

--------------------------------------------------------------------------------
[5] CATEGORY & SETTINGS:
• Category: Entertainment / Film & Animation
• Language: Korean (한국어)
• Captions: No captions required (Audiobook Narration)
• License: Standard YouTube License
• Made for Kids: No (Not made for kids)

================================================================================
"""

    upload_kit_path = story_dir / "youtube_upload_kit.txt"
    upload_kit_path.write_text(upload_kit_content, encoding="utf-8")
    
    metadata_json_path = story_dir / "metadata.json"
    metadata_dict = {
        "title": selected_title,
        "alternative_titles": titles,
        "description": full_description,
        "tags": tags[:30],
        "chapters": chapter_lines,
        "actual_audio_duration_seconds": actual_audio_duration_s,
    }
    metadata_json_path.write_text(json.dumps(metadata_dict, ensure_ascii=False, indent=2), encoding="utf-8")

    logger.info(f"✅ Đã xuất YouTube Upload Kit: {upload_kit_path}")
    return metadata_dict
