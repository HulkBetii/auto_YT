# -*- coding: utf-8 -*-
"""
Script xác thực kết nối E2E tới 9Router Gemini API Gateway trên localhost:20128.
"""

import sys
import os
import asyncio
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from auto_yt.gemini_api_engine import get_gemini_api_engine


async def main():
    print("=" * 60)
    print("🔍 Đang khởi tạo kết nối tới 9Router Gemini API Gateway...")
    print("=" * 60)

    engine = get_gemini_api_engine()
    print(f"📍 Base URL     : {engine.base_url}")
    print(f"🔑 Current Key  : {engine.get_current_key()[:8]}...{engine.get_current_key()[-4:]}")
    print(f"🤖 Default Model: {engine.default_model}")

    print("\n--- 1. Kiểm tra kết nối nhanh (Health Check) ---")
    ok, msg = await engine.test_connection()
    if ok:
        print(f"✅ {msg}")
    else:
        print(f"❌ {msg}")
        return

    print("\n--- 2. Thử nghiệm sinh kịch bản Drama Hàn Quốc (Prompt Test) ---")
    prompt = """
Hãy viết 1 phân đoạn kịch bản ngắn (khoảng 150-200 từ) cho tập phim Drama Hàn Quốc:
Chủ đề: Mẹ chồng gia tộc Chaebol đối đầu con dâu nghèo giàu nghị lực.
Yêu cầu bắt buộc:
1. Sử dụng định dạng thẻ nhân vật: [SPEAKER:me_chong], [SPEAKER:con_dau], [SPEAKER:nguoi_dan].
2. Lời thoại sắc bén, đậm chất drama trả thù Hàn Quốc.
"""
    try:
        res, used_model = await engine.generate_content(
            prompt=prompt,
            temperature=0.7,
            max_output_tokens=1024,
        )
        print(f"✅ Đã nhận phản hồi thành công từ model '{used_model}':\n")
        print("-" * 50)
        print(res.strip())
        print("-" * 50)
        print("\n🎉 XÁC THỰC 9ROUTER CHO DRAMA HÀN THÀNH CÔNG 100%!")
    except Exception as e:
        print(f"❌ Lỗi sinh nội dung: {e}")


if __name__ == "__main__":
    asyncio.run(main())
