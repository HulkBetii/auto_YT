#!/usr/bin/env python3
"""Drifter 2077 — local audio assembler (deferred pipeline, change #5).

Takes one `ready` episode and produces the final long-form audio track:
  1. Crossfade the chosen primary clips in chapter order (ffmpeg acrossfade).
  2. Loop the dedicated ambient-bed Suno track UNDER the whole mix at a low gain.
  3. Loudness-normalise the result (loudnorm I=-14:TP=-1:LRA=11 — sleep/study safe).

Reads episode data straight from Neon (same DSN the Python worker uses) so it has
no dependency on the web app being up. Output goes into the RUN_VEO-style project
folder `dr_e{id}/Download/audio/` to be muxed with the pixel loop video later.

Usage:
    python3 scripts/assemble_audio.py <episode_id> [--out DIR] [--crossfade SEC] [--bed-gain-db DB]

Requires: ffmpeg on PATH, `pip install asyncpg`.
"""
from __future__ import annotations

import argparse
import asyncio
import json
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

# Defaults mirror DR_CONFIG_KEYS / suno.ts constants; DB config overrides crossfade.
DEFAULT_CROSSFADE_SEC = 3.0
DEFAULT_BED_GAIN_DB = -18.0
LOUDNORM = "loudnorm=I=-14:TP=-1:LRA=11"
DEFAULT_RUN_VEO_ROOT = "/Users/sangspm/Downloads/VibeCoding/RUN_VEO_V1.1"
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
    return Path(root) / "Workflows" / f"dr_e{episode_id}" / "Download" / "audio"


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


def _download(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    print(f"  ↓ {dest.name}")
    urllib.request.urlretrieve(url, dest)
    return dest


def _build_ffmpeg_cmd(
    music: list[Path], bed: Path | None, crossfade: float, bed_gain_db: float, out: Path
) -> list[str]:
    """Crossfade `music` in order, overlay the looped `bed` under it, then loudnorm."""
    cmd: list[str] = ["ffmpeg", "-y"]
    for p in music:
        cmd += ["-i", str(p)]
    if bed is not None:
        cmd += ["-stream_loop", "-1", "-i", str(bed)]

    parts: list[str] = []
    # Chain pairwise acrossfade across all music inputs.
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
    ap = argparse.ArgumentParser(description="Assemble Drifter 2077 episode audio.")
    ap.add_argument("episode_id", type=int)
    ap.add_argument("--out", default=None, help="output dir (default: RUN_VEO project folder)")
    ap.add_argument("--crossfade", type=float, default=None, help="override crossfade seconds")
    ap.add_argument("--bed-gain-db", type=float, default=DEFAULT_BED_GAIN_DB)
    args = ap.parse_args()

    ep = asyncio.run(_load_episode(args.episode_id))
    if ep["status"] not in ("ready", "image_gen_pending", "assembly_pending", "assembly_done"):
        print(f"⚠️  Episode #{ep['id']} status is '{ep['status']}' — audio may be incomplete.")

    crossfade = args.crossfade if args.crossfade is not None else ep["crossfade_sec"]
    work = _project_dir(args.episode_id, args.out)
    work.mkdir(parents=True, exist_ok=True)

    # Ordered primary clips (playlist order = specIndex, skip the bed at -1).
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
        music_paths.append(_download(clip["url"], work / clip["fileName"]))

    if not music_paths:
        sys.exit("No playable tracks found — nothing to assemble.")

    bed_path: Path | None = None
    bed = ep["ambient_bed_audio"]
    if bed and bed.get("status") == "done":
        clip = _primary_clip(bed)
        if clip:
            bed_path = _download(clip["url"], work / clip["fileName"])
    if bed_path is None:
        print("  ! no ambient bed available — assembling without underlay")

    out_file = work / f"dr_e{args.episode_id}_final_audio.mp3"
    cmd = _build_ffmpeg_cmd(music_paths, bed_path, crossfade, args.bed_gain_db, out_file)
    print(f"Assembling {len(music_paths)} tracks (crossfade {crossfade}s) → {out_file}")
    subprocess.run(cmd, check=True)
    print(f"✅ Done: {out_file}")


if __name__ == "__main__":
    main()
