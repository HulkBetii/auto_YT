# -*- coding: utf-8 -*-
"""
Test TTS on Gemini-3.8-Flash-High Benchmark Script
Synthesizes the emotional opening scene with broadcast-grade Korean TTS configurations.
"""

from __future__ import annotations

import sys
import os
import json
import asyncio
import logging
from pathlib import Path

# Add src to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from auto_yt.kr_tts_engine import KrTtsEngine, sanitize_korean_script_for_tts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("TestBenchmarkKrTts")

BENCHMARK_DATA_PATH = PROJECT_ROOT / "data" / "gemini_models_benchmark.json"
OUTPUT_DIR = PROJECT_ROOT / "output_drama_kr" / "benchmark_tts_eval"


async def main():
    print("=" * 70)
    print("🎙️ KOREAN TTS SYNTHESIS: AG/GEMINI-3.8-FLASH-HIGH BENCHMARK TEXT")
    print("=" * 70)

    if not BENCHMARK_DATA_PATH.exists():
        raise FileNotFoundError(f"Benchmark file not found: {BENCHMARK_DATA_PATH}")

    data = json.loads(BENCHMARK_DATA_PATH.read_text(encoding="utf-8"))
    high_model_entry = next((item for item in data if item.get("model") == "ag/gemini-3.8-flash-high"), None)

    if not high_model_entry:
        raise ValueError("Could not find ag/gemini-3.8-flash-high in benchmark data")

    story_text = high_model_entry["full_text"]
    cleaned_text = sanitize_korean_script_for_tts(story_text)
    
    print(f"Loaded story text: {len(story_text.split())} words, {len(cleaned_text)} chars")
    print(f"First 120 chars: {cleaned_text[:120]}...\n")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    engine = KrTtsEngine()

    configs = [
        {
            "id": "cfg_natural_drama",
            "name": "Natural Radio Drama (Pacing Optimized, rate=-3%, silence=380ms)",
            "rate": "-3%",
            "pitch": "-1Hz",
            "silence": 0.38,
        },
        {
            "id": "cfg_standard_broadcast",
            "name": "Standard Broadcast (Neutral, rate=+0%, pitch=+0Hz, silence=320ms)",
            "rate": "+0%",
            "pitch": "+0Hz",
            "silence": 0.32,
        },
        {
            "id": "cfg_expressive_deep",
            "name": "Expressive Deep Tone (rate=-5%, pitch=-2Hz, silence=420ms)",
            "rate": "-5%",
            "pitch": "-2Hz",
            "silence": 0.42,
        },
    ]

    results = []

    for cfg in configs:
        out_mp3 = OUTPUT_DIR / f"tts_{cfg['id']}_gemini_38_flash_high.mp3"
        print(f"👉 Synthesizing with config [{cfg['name']}]...")
        t0 = asyncio.get_event_loop().time()

        res = await engine.synthesize_audiobook(
            text_or_file=story_text,
            output_file=out_mp3,
            rate=cfg["rate"],
            pitch=cfg["pitch"],
            silence_between_paragraphs_s=cfg["silence"],
        )

        elapsed = round(asyncio.get_event_loop().time() - t0, 2)
        dur = res["duration_seconds"]
        file_size_mb = round(out_mp3.stat().st_size / (1024 * 1024), 2)
        
        print(f"  ✅ Rendered {out_mp3.name} | Audio: {dur:.1f}s ({dur/60:.2f}m) | File: {file_size_mb} MB | Render Time: {elapsed}s\n")
        
        results.append({
            "config_id": cfg["id"],
            "name": cfg["name"],
            "file": str(out_mp3),
            "duration_s": dur,
            "duration_min": round(dur / 60, 2),
            "file_size_mb": file_size_mb,
            "render_time_s": elapsed,
        })

    summary_file = OUTPUT_DIR / "tts_evaluation_summary.json"
    summary_file.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved evaluation summary to: {summary_file}")


if __name__ == "__main__":
    asyncio.run(main())
