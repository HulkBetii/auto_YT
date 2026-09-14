"""
Bridge TTS script for web_ko_jp project.
Invokes GPT-SoVITS engine with the finalized drama style voice profile (Konosuke Matsushita - seg_A).
"""
import os
import sys
import argparse
import subprocess
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent.parent
VOICES_DIR = BASE_DIR / "data" / "voices"

DEFAULT_REF_AUDIO = VOICES_DIR / "konosuke_drama_ref.wav"
DEFAULT_REF_TEXT_FILE = VOICES_DIR / "konosuke_drama_ref.txt"

GPT_SOVITS_DIR = Path(r"D:\VibeCoding\GPT-SoVITS")
GPT_SOVITS_PY = GPT_SOVITS_DIR / ".venv" / "Scripts" / "python.exe"
GPT_SOVITS_SCRIPT = GPT_SOVITS_DIR / "scripts" / "tts_drama.py"


def generate_japanese_narration(
    text: str,
    output_path: str,
    ref_audio: str = str(DEFAULT_REF_AUDIO),
    ref_text: str = None,
    speed: float = 0.95,
    temperature: float = 1.0,
    top_k: int = 15,
    top_p: float = 0.85,
    repetition_penalty: float = 1.35,
    fragment_interval: float = 0.45,
    seed: int = -1,
):
    if not GPT_SOVITS_PY.exists():
        raise FileNotFoundError(f"GPT-SoVITS python not found at: {GPT_SOVITS_PY}")
    if not GPT_SOVITS_SCRIPT.exists():
        raise FileNotFoundError(f"TTS drama script not found at: {GPT_SOVITS_SCRIPT}")

    if ref_text is None:
        if DEFAULT_REF_TEXT_FILE.exists():
            ref_text = DEFAULT_REF_TEXT_FILE.read_text(encoding="utf-8").strip()
        else:
            ref_text = "長谷はちょっと頭が切れる人は、"

    out_file = Path(output_path).resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(GPT_SOVITS_PY),
        str(GPT_SOVITS_SCRIPT),
        "--text", text,
        "--output", str(out_file),
        "--ref_audio", str(ref_audio),
        "--ref_text", ref_text,
        "--speed", str(speed),
        "--temperature", str(temperature),
        "--top_k", str(top_k),
        "--top_p", str(top_p),
        "--repetition_penalty", str(repetition_penalty),
        "--fragment_interval", str(fragment_interval),
        "--seed", str(seed),
    ]

    print(f"[web_ko_jp TTS] Generating narration via GPT-SoVITS (Profile: Matsushita Drama Seg A)...")
    print(f"  Target: {out_file}")
    
    result = subprocess.run(cmd, cwd=str(GPT_SOVITS_DIR), capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        print(f"[web_ko_jp TTS ERROR] Exit code: {result.returncode}")
        print(result.stderr)
        raise RuntimeError(f"TTS synthesis failed: {result.stderr}")

    print(f"[web_ko_jp TTS SUCCESS] Generated audio: {out_file}")
    return str(out_file)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="web_ko_jp Drama Voice Synthesizer")
    parser.add_argument("--text", required=True, help="Japanese text to synthesize")
    parser.add_argument("--output", required=True, help="Path for output WAV")
    parser.add_argument("--speed", type=float, default=0.95, help="Speech speed")
    parser.add_argument("--seed", type=int, default=-1, help="Random seed")
    args = parser.parse_args()

    generate_japanese_narration(
        text=args.text,
        output_path=args.output,
        speed=args.speed,
        seed=args.seed,
    )