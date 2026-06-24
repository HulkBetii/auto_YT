#!/usr/bin/env python3
"""Drifter 2077 — full video assembler.

Combines:
  1. Audio assembly (crossfade + ambient bed + loudnorm) via assemble_audio logic.
  2. Mux with a user-provided loop.mp4 to produce final_video.mp4 (~1 playlist cycle).
  3. Loop final_video.mp4 up to ~8 hours for the YouTube long-form upload.

Usage:
    python3 scripts/assemble_video.py <episode_id> [--target-hours 8] [--bed-gain-db -18]

Requires: ffmpeg on PATH, `pip install asyncpg`.
"""
from __future__ import annotations

import argparse
import asyncio
import glob
import json
import math
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

try:
    import asyncpg
except ImportError:
    sys.exit("Missing dependency: pip install asyncpg")

DEFAULT_CROSSFADE_SEC = 3.0
DEFAULT_BED_GAIN_DB = -18.0
LOUDNORM = "loudnorm=I=-14:TP=-1:LRA=11"
DEFAULT_RUN_VEO_ROOT = "/Users/sangspm/Downloads/VibeCoding/RUN_VEO_V1.1"
DEFAULT_TARGET_HOURS = 8
_ASYNCPG_UNSUPPORTED = {"channel_binding", "options"}


def _sanitize_dsn(dsn: str) -> str:
    parsed = urlparse(dsn)
    params = [(k, v) for k, v in parse_qsl(parsed.query) if k not in _ASYNCPG_UNSUPPORTED]
    return urlunparse(parsed._replace(query=urlencode(params)))


def _load_database_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        return url
    env_local = Path(__file__).resolve().parent.parent / ".env.local"
    if env_local.exists():
        for line in env_local.read_text(encoding="utf-8").splitlines():
            m = re.match(r'^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?', line)
            if m:
                return m.group(1).strip()
    sys.exit("DATABASE_URL not set (env or web_3/.env.local).")


def _project_dir(episode_id: int, out: str | None) -> Path:
    if out:
        return Path(out)
    root = os.getenv("RUN_VEO_ROOT", DEFAULT_RUN_VEO_ROOT)
    return Path(root) / "Workflows" / f"dr_e{episode_id}" / "Download"


def _primary_clip(track: dict) -> dict | None:
    clips = track.get("clips") or []
    if not clips:
        return None
    idx = track.get("primaryClipIndex")
    if not isinstance(idx, int) or idx < 0 or idx >= len(clips):
        idx = 0
    return clips[idx]


async def _load_episode(episode_id: int) -> dict:
    dsn = _sanitize_dsn(_load_database_url())
    conn = await asyncpg.connect(dsn, statement_cache_size=0, timeout=30)
    try:
        row = await conn.fetchrow(
            "SELECT id, status, audio, ambient_bed_audio FROM dr_episodes WHERE id = $1",
            episode_id,
        )
        if row is None:
            sys.exit(f"Episode #{episode_id} not found.")
        crossfade = await conn.fetchval(
            "SELECT value FROM dr_channel_config WHERE key = 'crossfade_sec'"
        )
    finally:
        await conn.close()

    def _loads(v):
        return json.loads(v) if isinstance(v, str) else v

    return {
        "id": row["id"],
        "status": row["status"],
        "audio": _loads(row["audio"]) or [],
        "ambient_bed_audio": _loads(row["ambient_bed_audio"]),
        "crossfade_sec": float(crossfade) if crossfade else DEFAULT_CROSSFADE_SEC,
    }


async def _update_status(episode_id: int, status: str, final_path: str) -> None:
    dsn = _sanitize_dsn(_load_database_url())
    conn = await asyncpg.connect(dsn, statement_cache_size=0, timeout=30)
    try:
        await conn.execute(
            "UPDATE dr_episodes SET status = $1, final_video_path = $2, updated_at = NOW() WHERE id = $3",
            status, final_path, episode_id,
        )
    finally:
        await conn.close()


def _download(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    print(f"  ↓ {dest.name}")
    urllib.request.urlretrieve(url, dest)
    return dest


def _get_duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(result.stdout.strip())


def _find_loop_video(download_dir: Path) -> Path | None:
    video_dir = download_dir / "video"
    if not video_dir.exists():
        return None
    for ext in ("*.mp4", "*.mov", "*.webm"):
        files = sorted(video_dir.glob(ext))
        if files:
            return files[0]
    return None


def _build_audio_cmd(
    music: list[Path], bed: Path | None, crossfade: float, bed_gain_db: float, out: Path
) -> list[str]:
    cmd: list[str] = ["ffmpeg", "-y"]
    for p in music:
        cmd += ["-i", str(p)]
    if bed is not None:
        cmd += ["-stream_loop", "-1", "-i", str(bed)]

    parts: list[str] = []
    cur = "[0:a]"
    if len(music) == 1:
        parts.append(f"{cur}anull[music]")
    else:
        for i in range(1, len(music)):
            out_label = "[music]" if i == len(music) - 1 else f"[a{i}]"
            parts.append(f"{cur}[{i}:a]acrossfade=d={crossfade}:c1=tri:c2=tri{out_label}")
            cur = out_label

    if bed is not None:
        bed_idx = len(music)
        parts.append(f"[{bed_idx}:a]volume={bed_gain_db}dB[bed]")
        parts.append(f"[music][bed]amix=inputs=2:duration=first:normalize=0[mixed]")
        final_in = "[mixed]"
    else:
        final_in = "[music]"
    parts.append(f"{final_in}{LOUDNORM}[out]")

    cmd += ["-filter_complex", ";".join(parts), "-map", "[out]"]
    cmd += ["-c:a", "libmp3lame", "-q:a", "2", str(out)]
    return cmd


def main() -> None:
    ap = argparse.ArgumentParser(description="Assemble Drifter 2077 episode video.")
    ap.add_argument("episode_id", type=int)
    ap.add_argument("--out", default=None, help="output dir (default: RUN_VEO project folder)")
    ap.add_argument("--crossfade", type=float, default=None, help="override crossfade seconds")
    ap.add_argument("--bed-gain-db", type=float, default=DEFAULT_BED_GAIN_DB)
    ap.add_argument("--target-hours", type=float, default=DEFAULT_TARGET_HOURS,
                    help="target video length in hours (default: 8)")
    ap.add_argument("--skip-audio", action="store_true",
                    help="skip audio assembly if final_audio.mp3 already exists")
    args = ap.parse_args()

    ep = asyncio.run(_load_episode(args.episode_id))
    if ep["status"] not in ("ready", "image_gen_pending", "assembly_pending", "assembly_done"):
        print(f"⚠️  Episode #{ep['id']} status is '{ep['status']}' — audio may be incomplete.")

    crossfade = args.crossfade if args.crossfade is not None else ep["crossfade_sec"]
    download_dir = _project_dir(args.episode_id, args.out)
    image_dir = download_dir / "image"
    video_dir = download_dir / "video"
    audio_dir = download_dir / "audio"
    image_dir.mkdir(parents=True, exist_ok=True)
    video_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)

    audio_file = audio_dir / f"dr_e{args.episode_id}_final_audio.mp3"

    # ── Step 1: Audio assembly ────────────────────────────────────────────────
    if args.skip_audio and audio_file.exists():
        print(f"Skipping audio assembly — {audio_file} already exists.")
    else:
        tracks = sorted(
            [t for t in ep["audio"] if t.get("specIndex", 0) >= 0 and t.get("status") == "done"],
            key=lambda t: t["specIndex"],
        )
        music_paths: list[Path] = []
        for t in tracks:
            clip = _primary_clip(t)
            if not clip:
                print(f"  ! track {t.get('specIndex')} has no clip — skipping")
                continue
            music_paths.append(_download(clip["url"], audio_dir / clip["fileName"]))

        if not music_paths:
            sys.exit("No playable tracks found — nothing to assemble.")

        bed_path: Path | None = None
        bed = ep["ambient_bed_audio"]
        if bed and bed.get("status") == "done":
            clip = _primary_clip(bed)
            if clip:
                bed_path = _download(clip["url"], audio_dir / clip["fileName"])
        if bed_path is None:
            print("  ! no ambient bed available — assembling without underlay")

        cmd = _build_audio_cmd(music_paths, bed_path, crossfade, args.bed_gain_db, audio_file)
        print(f"Assembling {len(music_paths)} tracks (crossfade {crossfade}s) → {audio_file}")
        subprocess.run(cmd, check=True)
        print(f"✅ Audio done: {audio_file}")

    # ── Step 2: Mux loop video + audio → final_video.mp4 ─────────────────────
    loop_video = _find_loop_video(download_dir)
    if loop_video is None:
        print(f"\n⚠️  No loop video found in {video_dir}.")
        print(f"   Place your loop.mp4 here: {video_dir / 'loop.mp4'}")
        print("   Audio assembly is complete — only video muxing remains.")
        return

    audio_duration = _get_duration(audio_file)
    final_video = download_dir / "final_video.mp4"

    print(f"\nMuxing {loop_video.name} ({_get_duration(loop_video):.1f}s loop) + audio ({audio_duration:.1f}s)...")

    mux_cmd = [
        "ffmpeg", "-y",
        "-stream_loop", "-1", "-i", str(loop_video),
        "-i", str(audio_file),
        "-t", str(audio_duration),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "h264_videotoolbox",
        "-b:v", "40M",
        "-c:a", "aac", "-b:a", "320k",
        "-shortest",
        "-movflags", "+faststart",
        str(final_video),
    ]
    subprocess.run(mux_cmd, check=True)
    print(f"✅ Final video (1 cycle): {final_video} ({audio_duration:.0f}s)")

    # ── Step 3: Loop final_video to ~target hours ─────────────────────────────
    target_sec = args.target_hours * 3600
    loop_count = max(1, math.floor(target_sec / audio_duration))

    if loop_count <= 1:
        print(f"Audio already >= {args.target_hours}h — no further looping needed.")
        long_video = final_video
    else:
        long_video = download_dir / f"dr_e{args.episode_id}_final_{int(args.target_hours)}h.mp4"

        concat_list = download_dir / "_concat.txt"
        concat_list.write_text(
            "\n".join(f"file '{final_video.name}'" for _ in range(loop_count)),
            encoding="utf-8",
        )

        total_sec = loop_count * audio_duration
        print(f"\nLooping {loop_count}× ({total_sec / 3600:.1f}h) → {long_video}")

        loop_cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0", "-i", str(concat_list),
            "-c", "copy",
            "-movflags", "+faststart",
            str(long_video),
        ]
        subprocess.run(loop_cmd, check=True)
        concat_list.unlink(missing_ok=True)
        print(f"✅ Long video: {long_video} ({total_sec / 3600:.1f}h)")

    # ── Step 4: Update DB status ──────────────────────────────────────────────
    asyncio.run(_update_status(args.episode_id, "assembly_done", str(long_video)))
    print(f"\n🎬 Episode #{args.episode_id} → assembly_done")


if __name__ == "__main__":
    main()
