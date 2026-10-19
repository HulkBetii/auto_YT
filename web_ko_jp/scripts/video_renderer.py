# -*- coding: utf-8 -*-
"""
Automated Fast GPU NVENC Video Renderer for Japanese Audio Drama (人生の真理)
Renders full 1080p MP4 videos from:
  1. Master Audio: drama_v{id}_*.wav
  2. Subtitles: sub_v{id}_*.srt (Japanese text hardsubbed with Yu Gothic)
  3. Background Clips: Randomly selected from C:\\Users\\HulkBeoti\\Downloads\\vd-jp

Features:
  - Default Muted Background: Original audio from background clips is stripped (-an) by default.
  - Pre-normalization Cache: Clips are scaled to 1920x1080 30fps CFR once via GPU NVENC (~20s).
  - Infinite Multi-pass Sequencer: Loops/shuffles clips to cover any audio duration (>12 min)
    with constraint that no two adjacent clips are identical.
  - Subtitle Styler: Clear white text with solid black outline using system Japanese font Yu Gothic.
  - Atmospheric Color Grade: Subtle darkening (-8% brightness, +6% contrast) for cinematic vibe
    and subtitle readability.
  - Thumbnail Auto-Optimizer: Converts oversized thumbnails (>2MB) to high-quality JPEG for YouTube Studio.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("video_renderer")

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "web_ko_jp" / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

DEFAULT_BG_DIR = Path(r"C:\Users\HulkBeoti\Downloads\vd-jp")
DEFAULT_CACHE_DIR = REPO_ROOT / "web_ko_jp" / ".cache" / "norm_clips"
RENDER_SUBDIR = "render"
MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024  # 2MB YouTube limit


def get_ffmpeg_bin() -> str:
    """Retrieves path to FFmpeg binary via imageio_ffmpeg or system PATH."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        import shutil
        p = shutil.which("ffmpeg")
        if p:
            return p
    return "ffmpeg"


def is_nvenc_available(ffmpeg_bin: str) -> bool:
    """Checks if NVIDIA h264_nvenc hardware encoder is supported."""
    try:
        res = subprocess.run(
            [ffmpeg_bin, "-encoders"],
            capture_output=True,
            text=True,
            timeout=10,
            encoding="utf-8",
            errors="ignore",
        )
        return "h264_nvenc" in res.stdout
    except Exception as err:
        logger.warning(f"Could not probe NVENC support: {err}")
        return False


def get_media_duration(file_path: Path, ffmpeg_bin: Optional[str] = None) -> float:
    """Probes exact media duration (audio or video) using FFmpeg."""
    bin_path = ffmpeg_bin or get_ffmpeg_bin()
    try:
        cmd = [bin_path, "-i", str(file_path)]
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", res.stderr)
        if m:
            h, m_val, s = float(m.group(1)), float(m.group(2)), float(m.group(3))
            return h * 3600.0 + m_val * 60.0 + s
    except Exception as err:
        logger.warning(f"Error measuring duration for {file_path}: {err}")
    return 0.0


def normalize_clip(
    input_path: Path,
    output_path: Path,
    ffmpeg_bin: str,
    use_nvenc: bool = True,
    mute_audio: bool = True,
) -> bool:
    """
    Normalizes a single background video clip to standard 1080p 30fps CFR.
    Strips audio if mute_audio is True.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    vcodec = "h264_nvenc" if use_nvenc else "libx264"
    preset_opts = ["-preset", "p4", "-cq", "22"] if use_nvenc else ["-preset", "veryfast", "-crf", "22"]

    cmd = [
        ffmpeg_bin, "-y",
        "-i", str(input_path),
        "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30",
        "-c:v", vcodec,
        *preset_opts,
        "-pix_fmt", "yuv420p",
    ]
    if mute_audio:
        cmd.append("-an")

    cmd.append(str(output_path))

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
        if res.returncode == 0 and output_path.exists() and output_path.stat().st_size > 1000:
            return True
        logger.warning(f"Normalization failed for {input_path.name}: {res.stderr[-300:]}")
        return False
    except Exception as err:
        logger.error(f"Normalization exception for {input_path.name}: {err}")
        return False


def ensure_normalized_cache(
    raw_clips_dir: Path,
    cache_dir: Path,
    ffmpeg_bin: str,
    use_nvenc: bool = True,
    mute_audio: bool = True,
    force_rebuild: bool = False,
) -> List[Tuple[Path, float]]:
    """
    Scans raw background clips and ensures normalized 1080p 30fps copies exist in cache_dir.
    Saves an index JSON with clip durations for near-instant subsequent loads.
    """
    if not raw_clips_dir.exists():
        raise FileNotFoundError(f"Raw background clips directory not found: {raw_clips_dir}")

    cache_dir.mkdir(parents=True, exist_ok=True)
    index_file = cache_dir / "cache_index.json"
    index_data: Dict[str, float] = {}

    if index_file.exists() and not force_rebuild:
        try:
            with open(index_file, "r", encoding="utf-8") as f:
                index_data = json.load(f)
        except Exception:
            index_data = {}

    raw_clips = sorted(list(raw_clips_dir.glob("*.mp4")))
    if not raw_clips:
        raise FileNotFoundError(f"No .mp4 clips found in {raw_clips_dir}")

    normalized_clips: List[Tuple[Path, float]] = []
    to_process: List[Path] = []

    for clip in raw_clips:
        target_name = f"norm_{clip.stem}.mp4"
        cached_clip = cache_dir / target_name
        if not force_rebuild and cached_clip.exists() and cached_clip.stat().st_size > 1000 and target_name in index_data:
            normalized_clips.append((cached_clip, index_data[target_name]))
        else:
            to_process.append(clip)

    if to_process:
        logger.info(f"Normalizing {len(to_process)} clips into cache {cache_dir} (NVENC={use_nvenc}, Mute={mute_audio})...")
        for i, clip in enumerate(to_process, start=1):
            target_name = f"norm_{clip.stem}.mp4"
            cached_clip = cache_dir / target_name
            ok = normalize_clip(clip, cached_clip, ffmpeg_bin, use_nvenc=use_nvenc, mute_audio=mute_audio)
            if ok:
                dur = get_media_duration(cached_clip, ffmpeg_bin)
                index_data[target_name] = dur
                normalized_clips.append((cached_clip, dur))
                if i % 10 == 0 or i == len(to_process):
                    logger.info(f"  [{i}/{len(to_process)}] Cached {target_name} ({dur:.1f}s)")
            else:
                logger.error(f"Failed to normalize {clip.name}")

        try:
            with open(index_file, "w", encoding="utf-8") as f:
                json.dump(index_data, f, indent=2, ensure_ascii=False)
        except Exception as err:
            logger.warning(f"Could not save cache index: {err}")

    if not normalized_clips:
        raise RuntimeError("No background clips could be normalized.")

    total_pool_dur = sum(dur for _, dur in normalized_clips)
    logger.info(f"Background clip pool ready: {len(normalized_clips)} clips, total {total_pool_dur:.1f}s ({total_pool_dur/60:.1f}m)")
    return normalized_clips


def build_clip_sequence(
    cached_clips: List[Tuple[Path, float]],
    target_duration: float,
    seed: Optional[int] = None,
    buffer_seconds: float = 5.0,
) -> List[Path]:
    """
    Selects a randomized sequence of clips totaling >= (target_duration + buffer_seconds).
    Ensures that no two adjacent clips are identical.
    """
    if not cached_clips:
        raise ValueError("Cannot build sequence from empty clip list.")

    rng = random.Random(seed) if seed is not None else random.Random()
    clips_pool = list(cached_clips)

    sequence: List[Path] = []
    accumulated_dur = 0.0
    last_clip: Optional[Path] = None
    target_with_buffer = target_duration + buffer_seconds

    while accumulated_dur < target_with_buffer:
        # Shuffle a fresh round
        shuffled = list(clips_pool)
        rng.shuffle(shuffled)

        # If first clip of new round is identical to last clip of previous round, swap it
        if last_clip and shuffled[0][0] == last_clip and len(shuffled) > 1:
            shuffled[0], shuffled[1] = shuffled[1], shuffled[0]

        for clip_path, dur in shuffled:
            if last_clip and clip_path == last_clip and len(clips_pool) > 1:
                continue
            sequence.append(clip_path)
            accumulated_dur += dur
            last_clip = clip_path
            if accumulated_dur >= target_with_buffer:
                break

    return sequence


def write_concat_file(sequence: List[Path], concat_file_path: Path) -> Path:
    """Writes an FFmpeg concat demuxer file list."""
    concat_file_path.parent.mkdir(parents=True, exist_ok=True)
    with open(concat_file_path, "w", encoding="utf-8") as f:
        for clip in sequence:
            posix_path = clip.resolve().as_posix()
            f.write(f"file '{posix_path}'\n")
    return concat_file_path


def optimize_thumbnail(
    thumbnail_path: Path,
    ffmpeg_bin: str,
    max_bytes: int = MAX_THUMBNAIL_BYTES,
) -> Path:
    """
    If thumbnail file size exceeds max_bytes (2MB), compresses it to an ultra-high-quality
    JPEG (~800KB) matching YouTube guidelines. Returns path to compliant thumbnail.
    """
    if not thumbnail_path.exists():
        return thumbnail_path

    current_size = thumbnail_path.stat().st_size
    if current_size <= max_bytes and thumbnail_path.suffix.lower() in (".jpg", ".jpeg", ".png"):
        return thumbnail_path

    # Need compression / conversion to JPG
    target_jpg = thumbnail_path.with_suffix(".jpg")
    logger.info(f"Thumbnail size ({current_size:,} bytes) > 2MB limit. Optimizing to {target_jpg.name}...")

    cmd = [
        ffmpeg_bin, "-y",
        "-i", str(thumbnail_path),
        "-q:v", "2",
        str(target_jpg)
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if res.returncode == 0 and target_jpg.exists():
        new_size = target_jpg.stat().st_size
        logger.info(f"Thumbnail successfully optimized: {new_size:,} bytes ({new_size/1024/1024:.2f}MB)")
        return target_jpg
    else:
        logger.warning(f"Could not optimize thumbnail: {res.stderr[-200:]}")
        return thumbnail_path


def find_video_assets(video_id: int, base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Finds all required input and output files for video_id."""
    search_dir = base_dir or (REPO_ROOT / "web_ko_jp" / "output")
    matching_folders = [d for d in search_dir.glob(f"v{video_id}_*") if d.is_dir()]
    if not matching_folders:
        raise FileNotFoundError(f"Could not find output directory for v{video_id}_* in {search_dir}")

    folder = matching_folders[0]
    render_dir = folder / RENDER_SUBDIR
    render_dir.mkdir(parents=True, exist_ok=True)

    # 1. Audio WAV
    audio_candidates = sorted(list(folder.glob(f"drama_v{video_id}_*.wav")))
    if not audio_candidates:
        audio_candidates = sorted(list(folder.glob("*.wav")))
    if not audio_candidates:
        raise FileNotFoundError(f"No WAV audio found in {folder}")
    audio_path = audio_candidates[0]

    # 2. Subtitle SRT
    srt_candidates = sorted(list(folder.glob(f"sub_v{video_id}_*.srt")))
    if not srt_candidates:
        srt_candidates = sorted(list(folder.glob("*.srt")))
    srt_path = srt_candidates[0] if srt_candidates else None

    # 3. Thumbnail
    thumb_candidates = (
        sorted(list(folder.glob(f"thumb_v{video_id}_*.jpg")))
        + sorted(list(folder.glob(f"thumb_v{video_id}_*.png")))
        + sorted(list(folder.glob("thumb_*.png")))
        + sorted(list(folder.glob("*.png")))
    )
    thumb_path = thumb_candidates[0] if thumb_candidates else None

    # 4. Final output target
    output_mp4 = render_dir / f"final_v{video_id}.mp4"

    return {
        "folder": folder,
        "render_dir": render_dir,
        "audio_path": audio_path,
        "srt_path": srt_path,
        "thumb_path": thumb_path,
        "output_mp4": output_mp4,
    }


def render_video_jp(
    video_id: int,
    background_dir: Optional[Path] = None,
    cache_dir: Optional[Path] = None,
    output_mp4: Optional[Path] = None,
    preview_seconds: Optional[float] = None,
    burn_subtitles: bool = False,
    mute_background: bool = True,
    force_rebuild_cache: bool = False,
    seed: Optional[int] = None,
    prefer_nvenc: bool = True,
) -> Path:
    """
    Renders 1080p YouTube video for Japanese audio drama.
    
    Args:
        video_id: ID of the video (e.g. 8)
        background_dir: Directory containing Japanese scenic background clips
        cache_dir: Directory to cache normalized 1080p 30fps clips
        output_mp4: Explicit output path for rendered MP4 (defaults to render/final_v{id}.mp4)
        preview_seconds: Render only first N seconds (for rapid aesthetic preview)
        burn_subtitles: Whether to hardsub Japanese subtitles
        mute_background: Whether to strip background audio (True by default)
        force_rebuild_cache: Force re-normalizing background clips
        seed: Random seed for clip sequence reproducibility
        prefer_nvenc: Use NVIDIA NVENC hardware acceleration if available
    """
    ffmpeg_bin = get_ffmpeg_bin()
    has_nvenc = is_nvenc_available(ffmpeg_bin) if prefer_nvenc else False
    logger.info(f"Video Renderer initialized. FFmpeg: {ffmpeg_bin} | NVENC: {has_nvenc}")

    assets = find_video_assets(video_id)
    audio_path: Path = assets["audio_path"]
    srt_path: Optional[Path] = assets["srt_path"]
    thumb_path: Optional[Path] = assets["thumb_path"]
    final_output: Path = output_mp4 or assets["output_mp4"]
    final_output.parent.mkdir(parents=True, exist_ok=True)

    # 1. Probing audio duration
    audio_dur = get_media_duration(audio_path, ffmpeg_bin)
    if audio_dur <= 0.0:
        raise ValueError(f"Could not determine valid duration for {audio_path}")

    render_duration = preview_seconds if preview_seconds and preview_seconds > 0 else audio_dur
    logger.info(f"Audio file: {audio_path.name} ({audio_dur:.2f}s). Target render duration: {render_duration:.2f}s")

    # 2. Normalize and cache background clips
    bg_dir = background_dir or DEFAULT_BG_DIR
    c_dir = cache_dir or DEFAULT_CACHE_DIR
    cached_clips = ensure_normalized_cache(
        raw_clips_dir=bg_dir,
        cache_dir=c_dir,
        ffmpeg_bin=ffmpeg_bin,
        use_nvenc=has_nvenc,
        mute_audio=mute_background,
        force_rebuild=force_rebuild_cache,
    )

    # 3. Build sequence of clips
    seq_seed = seed if seed is not None else video_id
    sequence = build_clip_sequence(cached_clips, target_duration=render_duration, seed=seq_seed)
    concat_file = final_output.parent / f"concat_v{video_id}.txt"
    write_concat_file(sequence, concat_file)
    logger.info(f"Built background timeline: {len(sequence)} clips sequenced in {concat_file.name}")

    # 4. Construct FFmpeg Filter Graph
    # - Atmospheric color grade: slight dark tone and boost contrast for cinematic feel
    # - Subtitle filter: escaped path, Yu Gothic font, white with solid black outline
    filters: List[str] = ["eq=brightness=-0.08:contrast=1.06"]

    if burn_subtitles and srt_path and srt_path.exists():
        srt_escaped = str(srt_path.resolve()).replace("\\", "/").replace(":", r"\:")
        sub_style = (
            "Fontname=Yu Gothic,Fontsize=22,PrimaryColour=&H00FFFFFF,"
            "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=50"
        )
        filters.append(f"subtitles='{srt_escaped}':force_style='{sub_style}'")
        logger.info(f"Subtitle burning enabled: {srt_path.name}")
    elif burn_subtitles and (not srt_path or not srt_path.exists()):
        logger.warning(f"Subtitle file not found for v{video_id}. Proceeding without hardsub.")

    filter_complex = f"[0:v]{','.join(filters)}[v]"

    # 5. FFmpeg Command Assembly
    vcodec = "h264_nvenc" if has_nvenc else "libx264"
    preset_opts = ["-preset", "p4", "-b:v", "5000k", "-maxrate", "6500k", "-bufsize", "10000k"] if has_nvenc else ["-preset", "veryfast", "-crf", "20"]

    cmd = [
        ffmpeg_bin, "-y",
        "-f", "concat", "-safe", "0", "-i", str(concat_file),
        "-i", str(audio_path),
        "-filter_complex", filter_complex,
        "-map", "[v]",
        "-map", "1:a",
        "-c:v", vcodec,
        *preset_opts,
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "48000",
        "-t", f"{render_duration:.3f}",
        str(final_output),
    ]

    logger.info(f"Starting master render with [{vcodec}] -> {final_output}...")
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
        if res.returncode != 0:
            logger.warning(f"NVENC render failed ({res.stderr[-400:]}). Falling back to CPU libx264...")
            # Fallback to libx264
            idx = cmd.index(vcodec)
            cmd[idx] = "libx264"
            cmd[idx + 1 : idx + 7] = ["-preset", "veryfast", "-crf", "20"]
            res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
            if res.returncode != 0:
                raise RuntimeError(f"FFmpeg render failed: {res.stderr[-500:]}")

        if not final_output.exists() or final_output.stat().st_size < 50000:
            raise RuntimeError(f"Rendered file is missing or corrupted: {final_output}")

        file_size = final_output.stat().st_size
        actual_dur = get_media_duration(final_output, ffmpeg_bin)
        logger.info(
            f"✅ Master Video successfully rendered: {final_output.name} "
            f"({file_size/1024/1024:.1f} MB, {actual_dur:.1f}s)"
        )
    finally:
        # Clean up temporary concat file
        if concat_file.exists():
            try:
                concat_file.unlink()
            except Exception:
                pass

    # 6. Optimize thumbnail if present and >2MB
    if thumb_path and thumb_path.exists():
        optimize_thumbnail(thumb_path, ffmpeg_bin)

    return final_output


def main():
    parser = argparse.ArgumentParser(description="Japanese Audio Drama Auto Video Renderer (vd-jp background)")
    parser.add_argument("--video_id", type=int, required=True, help="Video ID (e.g. 8)")
    parser.add_argument("--background_dir", type=str, default=str(DEFAULT_BG_DIR), help="Path to raw background clips")
    parser.add_argument("--cache_dir", type=str, default=str(DEFAULT_CACHE_DIR), help="Path to normalized clips cache")
    parser.add_argument("--output", type=str, default=None, help="Explicit output MP4 path")
    parser.add_argument("--preview", type=float, default=None, help="Render preview of first N seconds (e.g. 30)")
    parser.add_argument("--sub", action="store_true", help="Enable hardsub Japanese subtitle burning (default is clean video without hardsubs)")
    parser.add_argument("--no_sub", action="store_true", help="Explicitly disable subtitles (default)")
    parser.add_argument("--keep_bg_audio", action="store_true", help="Do not mute background clips (NOT recommended)")
    parser.add_argument("--force_cache", action="store_true", help="Force rebuild background clip cache")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for clip sequencing")
    parser.add_argument("--cpu", action="store_true", help="Force CPU libx264 encoding")

    args = parser.parse_args()

    # Subtitles are disabled by default; only burned if --sub is explicitly passed
    should_burn_sub = args.sub and not args.no_sub

    try:
        out = render_video_jp(
            video_id=args.video_id,
            background_dir=Path(args.background_dir),
            cache_dir=Path(args.cache_dir),
            output_mp4=Path(args.output) if args.output else None,
            preview_seconds=args.preview,
            burn_subtitles=should_burn_sub,
            mute_background=not args.keep_bg_audio,
            force_rebuild_cache=args.force_cache,
            seed=args.seed,
            prefer_nvenc=not args.cpu,
        )
        print(f"\nSUCCESS: Rendered video saved to: {out}")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Render failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
