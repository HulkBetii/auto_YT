"""
Bridge TTS script for web_ko_jp project.
Invokes GPT-SoVITS engine with the finalized drama style voice profile (Konosuke Matsushita - seg_A).
Supports long Japanese scripts via file input (--text_file) or directly by database ID (--video_id).
"""
import os
import sys
import re
import unicodedata
import argparse
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional, Dict, Any

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent.parent
VOICES_DIR = BASE_DIR / "data" / "voices"

DEFAULT_REF_AUDIO = VOICES_DIR / "konosuke_drama_ref.wav"
DEFAULT_REF_TEXT_FILE = VOICES_DIR / "konosuke_drama_ref.txt"

GPT_SOVITS_DIR = Path(r"D:\VibeCoding\GPT-SoVITS")
GPT_SOVITS_PY = GPT_SOVITS_DIR / ".venv" / "Scripts" / "python.exe"
GPT_SOVITS_SCRIPT = GPT_SOVITS_DIR / "scripts" / "tts_drama.py"

# "cut1" = 4 sentences per synthesis piece. cut_drama_cadence made one piece per sentence, and
# short isolated pieces swallowed their first syllables (see prepare_tts_text).
TTS_SPLIT_METHOD = "cut1"
LINE_END_PUNCTUATION = "。！？!?」』、…"


def slugify_title(title: Optional[str], max_words: int = 6, max_chars: int = 35) -> str:
    """Normalizes title into a clean, filesystem-safe alphanumeric slug."""
    if not title:
        return "narration"
    text = unicodedata.normalize("NFKD", title)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.replace("đ", "d").replace("Đ", "D")
    text = re.sub(r"[^\w\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+", "_", text)
    text = re.sub(r"^_+|__+$", "", text)
    text = re.sub(r"_+", "_", text)
    if not text:
        return "narration"
    parts = [p for p in text.split("_") if p]
    if len(parts) > max_words:
        text = "_".join(parts[:max_words])
    if len(text) > max_chars:
        text = text[:max_chars].rstrip("_")
    return text or "narration"


def extract_youtube_id(url: Optional[str]) -> Optional[str]:
    """Extracts 11-char YouTube video ID from various URL formats."""
    if not url:
        return None
    m = re.search(r"(?:v=|\/|embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})", url)
    return m.group(1) if m else None


def build_video_base_name(
    video_id: Optional[int] = None,
    source_video_id: Optional[str] = None,
    source_url: Optional[str] = None,
    title: Optional[str] = None,
    timestamp: Optional[int] = None,
) -> str:
    """Generates standard descriptive base name: v{id}_{yt_id}_{slug}"""
    yt_id = source_video_id or extract_youtube_id(source_url)
    slug = slugify_title(title)
    parts = []
    if video_id is not None:
        parts.append(f"v{video_id}")
    if yt_id:
        parts.append(yt_id)
    if slug and slug != "narration":
        parts.append(slug)
    elif len(parts) == 0:
        parts.append("video")
    if video_id is None:
        ts = timestamp or int(time.time() * 1000)
        parts.append(str(ts))
    return "_".join(parts)


def build_drama_audio_filename(
    video_id: Optional[int] = None,
    source_video_id: Optional[str] = None,
    source_url: Optional[str] = None,
    title: Optional[str] = None,
    timestamp: Optional[int] = None,
) -> str:
    """Generates standard descriptive filename: drama_v{id}_{yt_id}_{slug}.wav"""
    base = build_video_base_name(video_id, source_video_id, source_url, title, timestamp)
    return f"drama_{base}.wav"


def build_thumbnail_filename(
    video_id: Optional[int] = None,
    source_video_id: Optional[str] = None,
    source_url: Optional[str] = None,
    title: Optional[str] = None,
    timestamp: Optional[int] = None,
) -> str:
    """Generates standard descriptive filename: thumb_v{id}_{yt_id}_{slug}.png"""
    base = build_video_base_name(video_id, source_video_id, source_url, title, timestamp)
    return f"thumb_{base}.png"


def build_summary_txt_filename(
    video_id: Optional[int] = None,
    source_video_id: Optional[str] = None,
    source_url: Optional[str] = None,
    title: Optional[str] = None,
    timestamp: Optional[int] = None,
) -> str:
    """Generates standard descriptive filename: summary_v{id}_{yt_id}_{slug}.txt"""
    base = build_video_base_name(video_id, source_video_id, source_url, title, timestamp)
    return f"summary_{base}.txt"


def build_data_json_filename(
    video_id: Optional[int] = None,
    source_video_id: Optional[str] = None,
    source_url: Optional[str] = None,
    title: Optional[str] = None,
    timestamp: Optional[int] = None,
) -> str:
    """Generates standard descriptive filename: data_v{id}_{yt_id}_{slug}.json"""
    base = build_video_base_name(video_id, source_video_id, source_url, title, timestamp)
    return f"data_{base}.json"


def get_video_meta_from_db(video_id: int) -> Dict[str, str]:
    """Fetch video record metadata from auto_yt_ko_jp PostgreSQL."""
    cmd = [
        "docker", "exec", "-i", "auto_yt_web_ko_jp_postgres",
        "psql", "-U", "postgres", "-d", "auto_yt_ko_jp", "-t", "-A", "-F", "|||",
        "-c", f"SELECT final_script_jp, COALESCE(source_title, ''), COALESCE(title_jp, ''), COALESCE(source_video_id, ''), COALESCE(source_url, '') FROM ko_jp_videos WHERE id = {video_id};"
    ]
    res = subprocess.run(cmd, capture_output=True, encoding="utf-8")
    if res.returncode != 0 or not res.stdout.strip():
        raise RuntimeError(f"Could not retrieve video data for video_id {video_id}: {res.stderr}")
    parts = res.stdout.strip().split("|||")
    return {
        "script": parts[0] if len(parts) > 0 else "",
        "source_title": parts[1] if len(parts) > 1 else "",
        "title_jp": parts[2] if len(parts) > 2 else "",
        "source_video_id": parts[3] if len(parts) > 3 else "",
        "source_url": parts[4] if len(parts) > 4 else "",
    }


def get_script_from_db(video_id: int) -> str:
    """Fetch final_script_jp for a given video ID from auto_yt_ko_jp PostgreSQL."""
    meta = get_video_meta_from_db(video_id)
    return meta["script"]


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


def prepare_tts_text(script: str) -> str:
    """
    Joins the script's one-sentence lines into running text for GPT-SoVITS.

    Why: GPT-SoVITS always splits its input on newlines, whatever text_split_method says, and
    synthesizes each piece without context. The drama scripts put every short sentence on its own
    line (「だから何だ。」「車を出す。」), and those isolated pieces lost or garbled their onsets:
    v8 read 73% of the script's kana as written, 37% of sentence onsets intact. With the lines
    joined and TTS_SPLIT_METHOD grouping sentences, the same voice and settings read 95% / 83%
    (A/B test 2026-10-05, 2 seeds each).
    """
    lines = [line.strip() for line in (script or "").splitlines() if line.strip()]
    # A line without closing punctuation would run into the next sentence when joined.
    return "".join(line if line[-1] in LINE_END_PUNCTUATION else line + "。" for line in lines)


def generate_japanese_narration(
    text: Optional[str] = None,
    text_file: Optional[str] = None,
    video_id: Optional[int] = None,
    title: Optional[str] = None,
    source_video_id: Optional[str] = None,
    source_url: Optional[str] = None,
    output_path: Optional[str] = None,
    ref_audio: str = str(DEFAULT_REF_AUDIO),
    ref_text: Optional[str] = None,
    speed: float = 0.95,
    temperature: float = 1.0,
    top_k: int = 15,
    top_p: float = 0.85,
    repetition_penalty: float = 1.35,
    fragment_interval: float = 0.50,
    text_split_method: str = TTS_SPLIT_METHOD,
    seed: int = -1,
) -> str:
    if not GPT_SOVITS_PY.exists():
        raise FileNotFoundError(f"GPT-SoVITS python not found at: {GPT_SOVITS_PY}")
    if not GPT_SOVITS_SCRIPT.exists():
        raise FileNotFoundError(f"TTS drama script not found at: {GPT_SOVITS_SCRIPT}")

    # Handle source text and metadata
    temp_text_path = None
    meta = {}
    if video_id is not None:
        print(f"[web_ko_jp TTS] Fetching Japanese drama script & metadata for video ID {video_id} from PostgreSQL...")
        meta = get_video_meta_from_db(video_id)
        if not text:
            text = meta.get("script", "")
        if not title:
            title = meta.get("source_title") or meta.get("title_jp")
        if not source_video_id:
            source_video_id = meta.get("source_video_id") or extract_youtube_id(meta.get("source_url"))
        if not source_url:
            source_url = meta.get("source_url")

    if text_file and Path(text_file).exists():
        text = Path(text_file).read_text(encoding="utf-8")
    if text:
        # Write to temporary file to safely handle any text length on Windows
        renders_dir = BASE_DIR / "data" / "renders"
        renders_dir.mkdir(parents=True, exist_ok=True)
        temp_file = renders_dir / f"temp_input_{int(time.time()*1000)}.txt"
        temp_file.write_text(prepare_tts_text(text), encoding="utf-8")
        temp_text_path = temp_file
        input_file_arg = str(temp_file.resolve())
    else:
        raise ValueError("Must provide either 'text', 'text_file', or 'video_id'.")

    if output_path is None:
        base_folder = build_video_base_name(
            video_id=video_id,
            source_video_id=source_video_id,
            source_url=source_url,
            title=title,
        )
        filename = build_drama_audio_filename(
            video_id=video_id,
            source_video_id=source_video_id,
            source_url=source_url,
            title=title,
        )
        video_out_dir = BASE_DIR / "output" / base_folder
        video_out_dir.mkdir(parents=True, exist_ok=True)
        output_path = str(video_out_dir / filename)

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

    # Auto-generate synchronized Japanese subtitles (.srt) for every video
    try:
        scripts_dir = Path(__file__).resolve().parent
        srt_script = scripts_dir / "generate_srt.py"
        srt_filename = f"sub_{out_file.parent.name}.srt"
        srt_path = out_file.parent / srt_filename
        print(f"[web_ko_jp TTS] Auto-generating synchronized subtitles (.srt): {srt_path}...")

        srt_cmd = [
            str(GPT_SOVITS_PY),
            str(srt_script),
            "--audio", str(out_file),
            "--output", str(srt_path),
            "--lang", "ja",
        ]
        ground_truth = text or (meta.get("script") if meta else None)
        temp_gt_file = None
        if ground_truth:
            temp_gt_file = out_file.parent / f"temp_gt_{int(time.time())}.txt"
            temp_gt_file.write_text(ground_truth, encoding="utf-8")
            srt_cmd.extend(["--script_file", str(temp_gt_file)])

        srt_res = subprocess.run(srt_cmd, capture_output=True, text=True, encoding="utf-8")
        if temp_gt_file and temp_gt_file.exists():
            try:
                temp_gt_file.unlink()
            except Exception:
                pass

        if srt_res.returncode == 0:
            print(f"[web_ko_jp TTS SUCCESS] Auto-generated subtitles (.srt): {srt_path}")
        else:
            print(f"[web_ko_jp TTS Warning] SRT generation exit code {srt_res.returncode}: {srt_res.stderr}")
    except Exception as srt_err:
        print(f"[web_ko_jp TTS Warning] Failed to auto-generate SRT: {srt_err}")

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
    parser.add_argument("--title", default="", help="Video title for descriptive file naming")
    parser.add_argument("--source_video_id", default="", help="YouTube video ID for descriptive file naming")
    parser.add_argument("--source_url", default="", help="YouTube source URL for descriptive file naming")
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
            title=args.title if args.title else None,
            source_video_id=args.source_video_id if args.source_video_id else None,
            source_url=args.source_url if args.source_url else None,
            output_path=out,
            speed=args.speed,
            seed=args.seed,
        )