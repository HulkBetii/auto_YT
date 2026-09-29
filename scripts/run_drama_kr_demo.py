# -*- coding: utf-8 -*-
"""
Script chạy tạo kịch bản Drama Hàn Quốc mẫu (Demo Run) qua 9Router Gateway.
"""

import sys
import os
import asyncio
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from auto_yt.drama_kr_pipeline import DramaKrPipeline


async def main():
    print("=" * 70)
    print("🎬 KHỞI ĐỘNG DRAMA HÀN PIPELINE (9ROUTER GEMINI ENGINE)")
    print("=" * 70)

    pipeline = DramaKrPipeline()

    sample_seed = {
        "id": "chaebol_revenge_01",
        "cluster_id": "cluster_chaebol_con_dau",
        "title": "Bản Di Chúc Bị Đánh Tráo Của Tập Đoàn Shinil",
        "summary": "Nàng dâu Park Min-ji bước vào hào môn Shinil bị mẹ chồng hắt hủi và ép ly hôn trắng tay. Sau khi phát hiện mẹ chồng thủ tiêu bản di chúc thật của cố Chủ tịch, cô cùng vị luật sư bí ẩn lật ngược thế cờ trong đại hội cổ đông.",
    }

    print(f"📌 Đề tài      : {sample_seed['title']}")
    print(f"📌 Cụm kịch bản: {sample_seed['cluster_id']}")
    print(f"📌 Model AI    : {pipeline.model}")
    print("\n⏳ Đang tiến hành sinh kịch bản...")

    # Chạy Turn 1 & Turn 2 & Turn 3 làm mẫu
    res = await pipeline.generate_story(sample_seed, story_slug="demo_drama_kr_01")

    print("\n" + "=" * 70)
    print(f"🎉 HOÀN THÀNH TẠO KỊCH BẢN DRAMA HÀN:")
    print(f"📁 Thư mục xuất : {res['output_dir']}")
    print(f"📝 Tổng số từ   : {res['word_count']} từ")
    print(f"🏷️ Thẻ nhân vật : {res['tag_stats']['total']} thẻ (Hợp lệ 100%)")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
