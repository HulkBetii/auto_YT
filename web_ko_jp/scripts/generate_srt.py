"""
Autonomous Subtitle (.srt) Generator for web_ko_jp YouTube videos.
Uses faster-whisper on GPU (NVIDIA RTX with CUDA / cublas64_12) to transcribe audio
and optionally aligns timestamps with ground-truth script text for 100% pristine Japanese subtitles.
"""
import os
import sys
import time
import json
import difflib
import re
import argparse
from pathlib import Path
from typing import Optional, List, Dict, Any

sys.stdout.reconfigure(encoding="utf-8")

# Ensure CUDA cublas libraries from torch can be loaded by CTranslate2 on Windows
try:
    import torch
    torch_lib = Path(torch.__file__).parent / "lib"
    if torch_lib.exists():
        os.add_dll_directory(str(torch_lib))
except Exception as e:
    pass

import faster_whisper
from faster_whisper import WhisperModel


def format_srt_timestamp(seconds: float) -> str:
    """Formats float seconds into standard SubRip timestamp (HH:MM:SS,mmm)."""
    if seconds < 0:
        seconds = 0.0
    millis = int(round((seconds % 1.0) * 1000))
    if millis >= 1000:
        millis = 999
    total_seconds = int(seconds)
    secs = total_seconds % 60
    mins = (total_seconds // 60) % 60
    hours = total_seconds // 3600
    return f"{hours:02d}:{mins:02d}:{secs:02d},{millis:03d}"


def parse_srt_timestamp(ts_str: str) -> float:
    """Parses HH:MM:SS,mmm into float seconds."""
    h, m, s_ms = ts_str.split(":")
    s, ms = s_ms.split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def split_japanese_sentences(text: str) -> List[str]:
    """Splits Japanese text into natural sentence-level subtitle units."""
    lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = re.split(r"(?<=[。！？\n])", line)
        for p in parts:
            p = p.strip()
            if p:
                lines.append(p)
    return lines


def align_ground_truth_to_cues(
    gt_text: str,
    raw_cues: List[Dict[str, Any]],
    min_duration: float = 0.6,
) -> List[Dict[str, Any]]:
    """
    Aligns ground truth script lines with raw Whisper cues using character timeline sequence matching.
    Ensures 100% exact ground truth vocabulary, kanji, and grammar while retaining audio sync.
    """
    gt_lines = split_japanese_sentences(gt_text)
    if not gt_lines:
        return raw_cues

    # Build character timeline from whisper cues
    char_times = []
    whisper_chars = []
    for c in raw_cues:
        text = c["text"]
        n = len(text)
        dur = c["end"] - c["start"]
        for k, ch in enumerate(text):
            t_start = c["start"] + (k / n) * dur
            t_end = c["start"] + ((k + 1) / n) * dur
            char_times.append((t_start, t_end))
            whisper_chars.append(ch)

    whisper_str = "".join(whisper_chars)
    gt_str = "".join(gt_lines)

    matcher = difflib.SequenceMatcher(None, whisper_str, gt_str)
    blocks = matcher.get_matching_blocks()

    gt_cues: List[Dict[str, Any]] = []
    gt_cursor = 0
    for idx, line in enumerate(gt_lines):
        line_len = len(line)
        gt_start = gt_cursor
        gt_end = gt_cursor + line_len
        gt_cursor = gt_end

        w_indices = []
        for a, b, size in blocks:
            overlap_start = max(b, gt_start)
            overlap_end = min(b + size, gt_end)
            if overlap_start < overlap_end:
                w_idx_start = a + (overlap_start - b)
                w_idx_end = a + (overlap_end - b)
                w_indices.extend([w_idx_start, w_idx_end])

        if w_indices:
            min_w = min(w_indices)
            max_w = max(w_indices)
            t_start = char_times[min(min_w, len(char_times) - 1)][0]
            t_end = char_times[min(max_w, len(char_times) - 1)][1]
        else:
            t_start = gt_cues[-1]["end"] if gt_cues else 0.0
            t_end = t_start + 2.0

        gt_cues.append({
            "index": idx + 1,
            "start": t_start,
            "end": t_end,
            "text": line
        })

    # Smooth cues for strict monotonicity and non-overlap
    for i in range(len(gt_cues)):
        c = gt_cues[i]
        if c["end"] < c["start"] + min_duration:
            c["end"] = c["start"] + min_duration
        if i > 0 and c["start"] < gt_cues[i - 1]["end"]:
            overlap = gt_cues[i - 1]["end"] - c["start"]
            mid = c["start"] + overlap / 2.0
            if mid > gt_cues[i - 1]["start"] + min_duration:
                gt_cues[i - 1]["end"] = mid
                c["start"] = mid
            else:
                c["start"] = gt_cues[i - 1]["end"]
                c["end"] = max(c["end"], c["start"] + min_duration)

    return gt_cues


def generate_srt_from_audio(
    audio_path: str,
    output_srt_path: str,
    language: str = "ja",
    model_size: str = "large-v3-turbo",
    device: str = "cuda",
    compute_type: str = "float16",
    ground_truth_script: Optional[str] = None,
) -> str:
    """
    Transcribes audio file to standard .srt subtitle file with timestamps,
    aligning with ground-truth script text if provided.
    """
    audio_file = Path(audio_path).resolve()
    if not audio_file.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_file}")

    out_srt = Path(output_srt_path).resolve()
    out_srt.parent.mkdir(parents=True, exist_ok=True)

    print(f"[SRT] Loading Whisper model '{model_size}' on {device} ({compute_type})...")
    t0 = time.time()
    try:
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
    except Exception as e:
        print(f"[SRT] Warning: Failed to load on {device} ({e}). Falling back to CPU int8...")
        model = WhisperModel(model_size, device="cpu", compute_type="int8")

    load_time = time.time() - t0
    print(f"[SRT] Model loaded in {load_time:.2f}s. Transcribing: {audio_file.name}...")

    t1 = time.time()
    segments, info = model.transcribe(
        str(audio_file),
        language=language,
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
    )

    raw_cues: List[Dict[str, Any]] = []
    idx = 1
    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        raw_cues.append({
            "index": idx,
            "start": seg.start,
            "end": seg.end,
            "text": text,
        })
        idx += 1

    elapsed = time.time() - t1
    audio_dur = info.duration if hasattr(info, "duration") else 0.0
    speedup = audio_dur / elapsed if elapsed > 0 and audio_dur > 0 else 0.0
    print(f"[SRT] ASR transcribed {len(raw_cues)} raw segments in {elapsed:.2f}s ({speedup:.1f}x real-time).")

    final_cues = raw_cues
    if ground_truth_script:
        print("[SRT] Aligning timestamps to Ground Truth script lines for 100% pristine text...")
        final_cues = align_ground_truth_to_cues(ground_truth_script, raw_cues)
        print(f"[SRT] Aligned successfully: {len(final_cues)} cues matched.")

    srt_entries: List[str] = []
    for c in final_cues:
        start_ts = format_srt_timestamp(c["start"])
        end_ts = format_srt_timestamp(c["end"])
        srt_entries.append(f"{c['index']}\n{start_ts} --> {end_ts}\n{c['text']}\n")

    srt_content = "\n".join(srt_entries)
    out_srt.write_text(srt_content, encoding="utf-8")
    print(f"[SRT] Final subtitle file saved: {out_srt} ({len(final_cues)} cues)")
    return str(out_srt)


def process_all_output_videos(lang: str = "ja", model_size: str = "large-v3-turbo", force: bool = False):
    """Scans web_ko_jp/output and ensures EVERY video with audio has a matching .srt subtitle file."""
    base_dir = Path(__file__).resolve().parent.parent
    output_dir = base_dir / "output"
    if not output_dir.exists():
        print(f"[SRT] Output directory not found: {output_dir}")
        return

    folders = [d for d in output_dir.iterdir() if d.is_dir()]
    print(f"[SRT] Found {len(folders)} video folder(s) in {output_dir}")

    for folder in folders:
        wavs = list(folder.glob("drama_*.wav"))
        if not wavs:
            continue
        audio_path = wavs[0]
        srt_path = folder / f"sub_{folder.name}.srt"
        if srt_path.exists() and not force:
            print(f"[SRT] [SKIP] {folder.name}: Subtitle already exists -> {srt_path.name}")
            continue

        print(f"[SRT] [PROCESS] {folder.name} -> Generating subtitle...")
        ground_truth = None
        json_file = folder / f"data_{folder.name}.json"
        if json_file.exists():
            try:
                data = json.loads(json_file.read_text(encoding="utf-8"))
                ground_truth = data.get("final_script_jp")
            except Exception:
                pass

        try:
            generate_srt_from_audio(
                audio_path=str(audio_path),
                output_srt_path=str(srt_path),
                language=lang,
                model_size=model_size,
                ground_truth_script=ground_truth,
            )
            print(f"[SRT] [OK] Created {srt_path.name}")
        except Exception as e:
            print(f"[SRT] [ERROR] Failed for {folder.name}: {e}")


def main():
    parser = argparse.ArgumentParser(description="Generate standard .srt subtitles from audio using faster-whisper")
    parser.add_argument("--audio", help="Path to input audio file (WAV/MP3)")
    parser.add_argument("--output", help="Path to output .srt file")
    parser.add_argument("--video_id", type=int, help="Video ID to process from web_ko_jp output directory")
    parser.add_argument("--script_file", help="Optional path to ground truth script text file for alignment")
    parser.add_argument("--all", action="store_true", help="Batch process all videos in web_ko_jp/output that lack .srt")
    parser.add_argument("--force", action="store_true", help="Overwrite existing .srt files when using --all")
    parser.add_argument("--lang", default="ja", help="Target language (default: ja)")
    parser.add_argument("--model", default="large-v3-turbo", help="Whisper model size")
    args = parser.parse_args()

    if args.all:
        process_all_output_videos(lang=args.lang, model_size=args.model, force=args.force)
        return

    audio_path = args.audio
    output_srt = args.output
    ground_truth = None

    if args.video_id and not audio_path:
        base_dir = Path(__file__).resolve().parent.parent
        output_dir = base_dir / "output"
        target_folder = None
        for item in output_dir.iterdir():
            if item.is_dir() and item.name.startswith(f"v{args.video_id}_"):
                target_folder = item
                break
        
        if not target_folder:
            print(f"[ERROR] Could not find folder for video ID {args.video_id} in {output_dir}")
            sys.exit(1)

        wavs = list(target_folder.glob("drama_*.wav"))
        if not wavs:
            print(f"[ERROR] No drama_*.wav found in {target_folder}")
            sys.exit(1)
        
        audio_path = str(wavs[0])
        slug_name = target_folder.name
        output_srt = str(target_folder / f"sub_{slug_name}.srt")
        
        # Check if data JSON has final_script_jp
        json_file = target_folder / f"data_{slug_name}.json"
        if json_file.exists():
            try:
                data = json.loads(json_file.read_text(encoding="utf-8"))
                ground_truth = data.get("final_script_jp")
                if ground_truth:
                    print(f"[SRT] Loaded ground-truth Japanese script from {json_file.name} ({len(ground_truth)} chars)")
            except Exception as e:
                print(f"[SRT] Notice: Could not read script from json: {e}")

        print(f"[SRT] Auto-detected video {args.video_id}:")
        print(f"  Audio: {audio_path}")
        print(f"  Output SRT: {output_srt}")

    if args.script_file and not ground_truth:
        ground_truth = Path(args.script_file).read_text(encoding="utf-8")

    if not audio_path or not output_srt:
        parser.error("Either --audio and --output, --video_id, or --all must be provided.")

    generate_srt_from_audio(
        audio_path=audio_path,
        output_srt_path=output_srt,
        language=args.lang,
        model_size=args.model,
        ground_truth_script=ground_truth,
    )


if __name__ == "__main__":
    main()
