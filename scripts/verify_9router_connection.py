# -*- coding: utf-8 -*-
"""
Smoke test and latency check for 9Router Gemini API Gateway in auto_YT.
"""
import os
import sys
import time
import asyncio
from pathlib import Path

# Add src to sys.path
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from auto_yt.gemini_api_engine import get_gemini_api_engine


async def main():
    print("=" * 60)
    print("🚀 9ROUTER GEMINI API GATEWAY — SMOKE TEST & LATENCY CHECK")
    print("=" * 60)

    engine = get_gemini_api_engine()
    print(f"Base URL     : {engine.base_url}")
    print(f"Default Model: {engine.default_model}")
    print(f"Active Key   : {engine.get_current_key()[:8]}... (Total Keys: {len(engine.api_keys)})")

    # 1. Test basic connection
    print("\n[Step 1] Testing basic connection...")
    t0 = time.time()
    ok, msg = await engine.test_connection()
    t1 = time.time()
    if ok:
        print(f"✅ Connection OK ({t1 - t0:.2f}s): {msg}")
    else:
        print(f"❌ Connection FAILED ({t1 - t0:.2f}s): {msg}")
        sys.exit(1)

    # 2. Test creative generation (Vietnamese prompt)
    print("\n[Step 2] Testing creative prompt generation in Vietnamese...")
    prompt = (
        "Bạn là biên kịch audio drama 'Sâm Kể Chuyện'. "
        "Hãy viết một đoạn mở đầu 2 câu đầy cảm xúc và chiêm nghiệm về tình mẫu tử thiêng liêng."
    )
    t0 = time.time()
    text, model_used = await engine.generate_content(
        prompt=prompt,
        temperature=0.7,
        max_output_tokens=500
    )
    t1 = time.time()
    print(f"✅ Model [{model_used}] responded in {t1 - t0:.2f}s:")
    print("-" * 50)
    print(text)
    print("-" * 50)

    print("\n🎉 9Router Gemini API Gateway is 100% OPERATIONAL!")


if __name__ == "__main__":
    asyncio.run(main())
