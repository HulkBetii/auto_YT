#!/usr/bin/env python3
"""ffmpeg assembly for the 哲人の刻 render pipeline.

Builds a slideshow from a folder of pre-composed 1920x1080 character images
(one changes every ~30s, chosen shuffle-bag so none repeats within a full pass),
crossfades between them, burns the Whisper-timed subtitles, and muxes the TTS
audio underneath → final_video.mp4.

Reuses the ffmpeg-resolution / duration-probe / encoder-selection ideas from
RUN_VEO_V1.1/assemble_video.py.

Standalone:
    python -m auto_yt.render.assemble --image-dir <dir> --audio-file a.mp3 \
        --subs sub.ass --out final_video.mp4
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Callable

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
OUTPUT_FPS = 30
SECONDS_PER_IMAGE = 30.0
CROSSFADE_SECONDS = 0.5
FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"


# ── ffmpeg / ffprobe resolution ─────────────────────────────────────────────

def resolve_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    raise RuntimeError("FFmpeg not found — install ffmpeg or `pip install imageio-ffmpeg`.")


def resolve_ffprobe() -> str:
    exe = shutil.which("ffprobe")
    if exe:
        return exe
    # ffprobe usually sits next to ffmpeg
    candidate = Path(resolve_ffmpeg()).with_name("ffprobe.exe" if os.name == "nt" else "ffprobe")
    if candidate.exists():
        return str(candidate)
    raise RuntimeError("ffprobe not found — install ffmpeg (full build).")


def get_media_duration(path: str, ffprobe: str) -> float:
    result = subprocess.run(
        [ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", path],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {(result.stderr or '')[-1000:]}")
    try:
        data = json.loads(result.stdout)
        duration = float(data["format"]["duration"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"ffprobe returned invalid duration data for {path}") from exc
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError(f"Invalid media duration for {path}: {duration}")
    return duration


def get_media_stream_types(path: str, ffprobe: str) -> set[str]:
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_entries",
            "stream=codec_type",
            path,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe stream check failed for {path}")
    try:
        data = json.loads(result.stdout)
        return {
            str(stream["codec_type"])
            for stream in data.get("streams", [])
            if stream.get("codec_type")
        }
    except (TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"ffprobe returned invalid stream data for {path}") from exc


def validate_audio_file(path: Path, ffprobe: str | None = None) -> float:
    if not path.is_file() or path.stat().st_size <= 0:
        raise RuntimeError(f"Audio file is missing or empty: {path}")
    probe = ffprobe or resolve_ffprobe()
    if "audio" not in get_media_stream_types(str(path), probe):
        raise RuntimeError(f"Input contains no audio stream: {path}")
    return get_media_duration(str(path), probe)


# ── Image selection (shuffle-bag: no repeat within one full pass) ────────────

def list_pool(image_dir: Path) -> list[Path]:
    if not image_dir.exists():
        raise RuntimeError(f"Image folder does not exist: {image_dir}")
    pool = sorted(
        p for p in image_dir.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES and p.stat().st_size > 0
    )
    if not pool:
        raise RuntimeError(f"No usable images in: {image_dir}")
    return pool


def select_images(pool: list[Path], n: int, seed: int | None = None) -> list[Path]:
    """Draw `n` images. Each pass through the pool is a fresh shuffle, so no
    image repeats until the whole pool has been used (then a new pass begins)."""
    rng = random.Random(seed)
    chosen: list[Path] = []
    bag: list[Path] = []
    while len(chosen) < n:
        if not bag:
            bag = pool[:]
            rng.shuffle(bag)
        chosen.append(bag.pop())
    return chosen


# ── ffmpeg command construction ─────────────────────────────────────────────

def _escape_filter_path(p: str) -> str:
    """Escape a path for use inside an ffmpeg filtergraph value.
    Backslashes → forward slashes; the drive/option colon → \\: ."""
    return str(p).replace("\\", "/").replace(":", "\\:")


def _video_encoder_args(ffmpeg: str) -> list[str]:
    try:
        result = subprocess.run(
            [ffmpeg, "-hide_banner", "-encoders"],
            capture_output=True, text=True, encoding="utf-8", errors="ignore", check=False,
        )
        if "h264_nvenc" in (result.stdout or ""):
            return ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "19", "-b:v", "0", "-pix_fmt", "yuv420p"]
    except Exception:
        pass
    return ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"]


def _build_filter(n: int, seconds: float, crossfade: float, ass_path: Path, font_dir: Path) -> str:
    prep = (
        "scale=1920:1080:force_original_aspect_ratio=decrease,"
        "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,"
        f"fps={OUTPUT_FPS},settb=AVTB,format=yuv420p"
    )
    parts = [f"[{i}:v]{prep}[v{i}]" for i in range(n)]

    if n == 1:
        last = "v0"
    elif crossfade == 0:
        inputs = "".join(f"[v{i}]" for i in range(n))
        parts.append(f"{inputs}concat=n={n}:v=1:a=0[vslide]")
        last = "vslide"
    else:
        prev = "v0"
        for k in range(1, n):
            out = "vslide" if k == n - 1 else f"x{k}"
            offset = k * seconds
            parts.append(
                f"[{prev}][v{k}]xfade=transition=fade:duration={crossfade}:offset={offset:.3f}[{out}]"
            )
            prev = out
        last = "vslide"

    subs = (
        f"subtitles=filename='{_escape_filter_path(ass_path)}'"
        f":fontsdir='{_escape_filter_path(font_dir)}'"
    )
    parts.append(f"[{last}]{subs}[vout]")
    return ";".join(parts)


def assemble(
    image_dir: Path,
    audio_path: Path,
    ass_path: Path,
    out_path: Path,
    *,
    seconds_per_image: float = SECONDS_PER_IMAGE,
    crossfade: float = CROSSFADE_SECONDS,
    font_dir: Path = FONT_DIR,
    seed: int | None = None,
    heartbeat: Callable[[], None] | None = None,
) -> Path:
    if seconds_per_image <= 0:
        raise ValueError("seconds_per_image must be greater than zero")
    if crossfade < 0 or crossfade >= seconds_per_image:
        raise ValueError("crossfade must be non-negative and shorter than seconds_per_image")

    ffmpeg = resolve_ffmpeg()
    ffprobe = resolve_ffprobe()

    audio_duration = validate_audio_file(audio_path, ffprobe)
    n = max(1, math.ceil(audio_duration / seconds_per_image))
    pool = list_pool(image_dir)
    images = select_images(pool, n, seed=seed)
    per_input_len = seconds_per_image + crossfade

    print(f"[assemble] audio={audio_duration:.1f}s → {n} image(s) from {len(pool)} in pool")

    filtergraph = _build_filter(n, seconds_per_image, crossfade, ass_path, font_dir)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    print("[assemble] running ffmpeg...")
    t0 = time.time()
    preferred_encoder = _video_encoder_args(ffmpeg)
    encoders = [preferred_encoder]
    if "h264_nvenc" in preferred_encoder:
        encoders.append(
            ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"]
        )

    last_error = ""
    for encoder_args in encoders:
        cmd: list[str] = [ffmpeg, "-y"]
        for img in images:
            cmd += ["-loop", "1", "-t", f"{per_input_len:.3f}", "-i", str(img)]
        cmd += ["-i", str(audio_path)]
        cmd += [
            "-filter_complex", filtergraph,
            "-map", "[vout]",
            "-map", f"{n}:a",
            *encoder_args,
            "-c:a", "aac", "-b:a", "192k",
            "-r", str(OUTPUT_FPS),
            "-shortest",
            "-t", f"{audio_duration:.3f}",
            "-movflags", "+faststart",
            str(out_path),
        ]
        return_code, stderr = _run_ffmpeg(cmd, heartbeat=heartbeat)
        if return_code == 0:
            break
        last_error = stderr
        out_path.unlink(missing_ok=True)
        if "h264_nvenc" in encoder_args:
            print("[assemble] NVENC failed; retrying with libx264...")
    else:
        raise RuntimeError(f"FFmpeg failed:\n{last_error[-2000:]}")

    # Verify output duration tracks the audio (guards silent ffmpeg truncation).
    output_streams = get_media_stream_types(str(out_path), ffprobe)
    if not {"audio", "video"}.issubset(output_streams):
        raise RuntimeError(f"Output is missing audio or video stream: {output_streams}")
    actual = get_media_duration(str(out_path), ffprobe)
    if abs(actual - audio_duration) > 2.0:
        raise RuntimeError(
            f"Output duration mismatch: expected {audio_duration:.1f}s, got {actual:.1f}s"
        )

    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"[assemble] done in {time.time() - t0:.1f}s — {size_mb:.1f} MB → {out_path}")
    return out_path


def _run_ffmpeg(
    cmd: list[str],
    *,
    heartbeat: Callable[[], None] | None,
) -> tuple[int, str]:
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8", errors="replace") as error_file:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=error_file,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        try:
            while process.poll() is None:
                if heartbeat is not None:
                    heartbeat()
                time.sleep(5)
            error_file.seek(0)
            return process.returncode or 0, error_file.read()
        except BaseException:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
            raise


# ── Audio download (for standalone / CLI use) ───────────────────────────────

def download_audio(url: str, dest: Path) -> Path:
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*",
        "Referer": "https://ai33.pro/",
    }
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp, dest.open("wb") as output:
        while chunk := resp.read(1024 * 1024):
            output.write(chunk)
    if dest.stat().st_size == 0:
        raise RuntimeError(f"Downloaded audio is empty: {url}")
    return dest


def main() -> None:
    parser = argparse.ArgumentParser(description="Assemble subtitled slideshow video")
    parser.add_argument("--image-dir", required=True)
    parser.add_argument("--audio-file", default="")
    parser.add_argument("--audio-url", default="")
    parser.add_argument("--subs", required=True, help="Path to the .ass subtitle file")
    parser.add_argument("--out", required=True)
    parser.add_argument("--seconds", type=float, default=SECONDS_PER_IMAGE)
    parser.add_argument("--crossfade", type=float, default=CROSSFADE_SECONDS)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    out_path = Path(args.out)
    if args.audio_file:
        audio_path = Path(args.audio_file)
    elif args.audio_url:
        audio_path = download_audio(args.audio_url, out_path.parent / "audio.mp3")
    else:
        parser.error("provide --audio-file or --audio-url")

    assemble(
        Path(args.image_dir), audio_path, Path(args.subs), out_path,
        seconds_per_image=args.seconds, crossfade=args.crossfade, seed=args.seed,
    )


if __name__ == "__main__":
    main()
