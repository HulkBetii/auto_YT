"""
Bridge TTS script for web_ko_jp project.
Invokes GPT-SoVITS engine with the finalized drama style voice profile (Konosuke Matsushita - seg_A).
Supports long Japanese scripts via file input (--text_file) or directly by database ID (--video_id).
"""
import os
import sys
import argparse
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent.parent
VOICES_DIR = BASE_DIR / "data" / "voices"

DEFAULT_REF_AUDIO = VOICES_DIR / "konosuke_drama_ref.wav"
DEFAULT_REF_TEXT_FILE = VOICES_DIR / "konosuke_drama_ref.txt"

GPT_SOVITS_DIR = Path(r"D:\VibeCoding\GPT-SoVITS")
GPT_SOVITS_PY = GPT_SOVITS_DIR / ".venv" / "Scripts" / "python.exe"
GPT_SOVITS_SCRIPT = GPT_SOVITS_DIR / "scripts" / "tts_drama.py"


def get_script_from_db(video_id: int) -> str:
    """Fetch final_script_jp for a given video ID from auto_yt_ko_jp PostgreSQL."""
    cmd = [
        "docker", "exec", "-i", "auto_yt_web_ko_jp_postgres",
        "psql", "-U", "postgres", "-d", "auto_yt_ko_jp", "-t", "-A",
        "-c", f"SELECT final_script_jp FROM ko_jp_videos WHERE id = {video_id};"
    ]
    res = subprocess.run(cmd, capture_output=True, encoding="utf-8")
    if res.returncode != 0 or not res.stdout.strip():
        raise RuntimeError(f"Could not retrieve script for video_id {video_id}: {res.stderr}")
    return res.stdout.strip()


def update_audio_in_db(video_id: int, audio_url: str, audio_path: str):
    """Save audio_url and audio_path to ko_jp_videos in PostgreSQL."""
    safe_path = audio_path.replace("'", "''")
    safe_url = audio_url.replace("'", "''")
    cmd = [
        "docker", "exec", "-i", "auto_yt_web_ko_jp_postgres",
        "psql", "-U", "postgres", "-d", "auto_yt_ko_jp",
        "-c", f"UPDATE ko_jp_videos SET audio_url = '{safe_url}', audio_path = '{safe_path}', updated_at = NOW() WHERE id = {video_id};"
    ]
    subprocess.run(cmd, capture_output=True)


def generate_japanese_narration(
    text: Optional[str] = None,
    text_file: Optional[str] = None,
    video_id: Optional[int] = None,
    output_path: Optional[str] = None,
    ref_audio: str = str(DEFAULT_REF_AUDIO),
    ref_text: Optional[str] = None,
    speed: float = 0.95,
    temperature: float = 1.0,
    top_k: int = 15,
    top_p: float = 0.85,
    repetition_penalty: float = 1.35,
    fragment_interval: float = 0.50,
    text_split_method: str = "cut_drama_cadence",
    seed: int = -1,
) -> str:
    if not GPT_SOVITS_PY.exists():
        raise FileNotFoundError(f"GPT-SoVITS python not found at: {GPT_SOVITS_PY}")
    if not GPT_SOVITS_SCRIPT.exists():
        raise FileNotFoundError(f"TTS drama script not found at: {GPT_SOVITS_SCRIPT}")

    # Handle source text
    temp_text_path = None
    if video_id is not None:
        print(f"[web_ko_jp TTS] Fetching Japanese drama script for video ID {video_id} from PostgreSQL...")
        text = get_script_from_db(video_id)
        if output_path is None:
            output_path = str(BASE_DIR / "data" / "renders" / f"drama_narration_{video_id}.wav")

    if text_file and Path(text_file).exists():
        input_file_arg = str(Path(text_file).resolve())
    elif text:
        # Write to temporary file to safely handle any text length on Windows
        renders_dir = BASE_DIR / "data" / "renders"
        renders_dir.mkdir(parents=True, exist_ok=True)
        temp_file = renders_dir / f"temp_input_{int(time.time()*1000)}.txt"
        temp_file.write_text(text, encoding="utf-8")
        temp_text_path = temp_file
        input_file_arg = str(temp_file.resolve())
    else:
        raise ValueError("Must provide either 'text', 'text_file', or 'video_id'.")

    if output_path is None:
        output_path = str(BASE_DIR / "data" / "renders" / f"drama_{int(time.time()*1000)}.wav")

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
        "--text_file", input_file_arg,
        "--output", str(out_file),
        "--ref_audio", str(ref_audio),
        "--ref_text", ref_text,
        "--speed", str(speed),
        "--temperature", str(temperature),
        "--top_k", str(top_k),
        "--top_p", str(top_p),
        "--repetition_penalty", str(repetition_penalty),
        "--fragment_interval", str(fragment_interval),
        "--text_split_method", str(text_split_method),
        "--seed", str(seed),
    ]

    print(f"[web_ko_jp TTS] Synthesizing Japanese narration via GPT-SoVITS (v2ProPlus + Cadence + Master)...")
    print(f"  Voice Profile: Konosuke Matsushita Drama (seg_A)")
    print(f"  Split Method: {text_split_method} (pause={fragment_interval}s)")
    print(f"  Output target: {out_file}")

    t0 = time.time()
    result = subprocess.run(cmd, cwd=str(GPT_SOVITS_DIR), capture_output=True, text=True, encoding="utf-8")
    
    # Cleanup temp file if created
    if temp_text_path and temp_text_path.exists():
        try:
            temp_text_path.unlink()
        except Exception:
            pass

    if result.returncode != 0:
        print(f"[web_ko_jp TTS ERROR] Exit code: {result.returncode}")
        print(result.stderr)
        raise RuntimeError(f"TTS synthesis failed: {result.stderr}")

    duration_sec = time.time() - t0
    print(f"[web_ko_jp TTS SUCCESS] Generated audio in {duration_sec:.1f}s: {out_file}")

    # Update database if video_id is known
    if video_id is not None:
        audio_url = f"/api/audio?file={out_file.name}"
        try:
            update_audio_in_db(video_id, audio_url, str(out_file))
            print(f"[web_ko_jp TTS] Updated video ID {video_id} with audio_url: {audio_url}")
        except Exception as db_err:
            print(f"[web_ko_jp TTS Warning] Failed to update DB: {db_err}")

    return str(out_file)


def master_existing_audio(input_wav: str, output_wav: Optional[str] = None) -> str:
    """Run FFmpeg mastering on an existing WAV file."""
    in_p = Path(input_wav).resolve()
    if not in_p.exists():
        raise FileNotFoundError(f"Input audio file not found: {in_p}")
    if output_wav is None:
        out_p = in_p
        temp_out = in_p.with_name(in_p.stem + "_temp_mastered" + in_p.suffix)
    else:
        out_p = Path(output_wav).resolve()
        temp_out = out_p

    filter_chain = (
        "volume=-2dB,"
        "highpass=f=80,"
        "equalizer=f=3000:t=q:w=1.5:g=1.5,"
        "acompressor=threshold=-14dB:ratio=2.5:attack=10:release=60,"
        "loudnorm=I=-14:LRA=11:TP=-1.5"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", str(in_p),
        "-af", filter_chain,
        "-ar", "32000",
        "-c:a", "pcm_s16le",
        str(temp_out)
    ]
    print(f"[Mastering] Running FFmpeg audio mastering on {in_p}...")
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg mastering failed: {res.stderr}")

    if output_wav is None:
        temp_out.replace(out_p)

    print(f"[Mastering SUCCESS] Saved mastered audio to {out_p}")
    return str(out_p)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="web_ko_jp Drama Voice Synthesizer")
    parser.add_argument("--text", default="", help="Japanese text to synthesize")
    parser.add_argument("--text_file", default="", help="Path to text file to synthesize")
    parser.add_argument("--video_id", type=int, default=None, help="Database Video ID to fetch script from")
    parser.add_argument("--master_file", default="", help="Path to existing WAV file to apply mastering to")
    parser.add_argument("--output", default="", help="Path for output WAV")
    parser.add_argument("--speed", type=float, default=0.95, help="Speech speed")
    parser.add_argument("--seed", type=int, default=-1, help="Random seed")
    args = parser.parse_args()

    if args.master_file:
        out = args.output if args.output else None
        master_existing_audio(args.master_file, out)
    else:
        out = args.output if args.output else None
        generate_japanese_narration(
            text=args.text if args.text else None,
            text_file=args.text_file if args.text_file else None,
            video_id=args.video_id,
            output_path=out,
            speed=args.speed,
            seed=args.seed,
        )