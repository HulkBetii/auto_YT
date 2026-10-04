"""
source_picker.py
================
Ranks the source channel's videos (Vietnamese "Cổ Nhân Dạy" titles) for cloning.

Why: impressions, not CTR or retention, are the channel's bottleneck. Of the first four uploads,
only the "spot the bad person" topic (「7つの言葉」) was tested widely by YouTube; generic life-rule
topics got 15-72 impressions. Source-channel view counts do not transfer to Japan, so they are only
a tie-breaker. This is a suggestion list; it never starts the pipeline.

Usage (repo root):
    uv run python web_ko_jp/scripts/source_picker.py --limit 40
    uv run python web_ko_jp/scripts/source_picker.py --channel @TrietLyCuocSong-TT --limit 60
"""
import argparse
import json
import math
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set

from pydantic import BaseModel, Field

from channel_profile import (
    SOURCE_CHANNEL_HANDLE,
    SOURCE_CLASSIC_TERMS,
    SOURCE_OLD_AGE_TERMS,
    SOURCE_PEOPLE_TERMS,
    SOURCE_SCORE_CLASSIC,
    SOURCE_SCORE_OLD_AGE,
    SOURCE_SCORE_PEOPLE,
)
from channel_registry import ChannelRegistry

DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "output" / "source_candidates.json"
DEFAULT_LIMIT = 40


class SourceCandidate(BaseModel):
    video_id: str
    title: str
    views: Optional[int] = None
    score: float = 0.0
    angles: List[str] = Field(default_factory=list)
    already_cloned: bool = False


def _hits(title: str, terms: Iterable[str]) -> List[str]:
    lowered = title.lower()
    return [t for t in terms if t in lowered]


def score_title(title: str, views: Optional[int] = None) -> SourceCandidate:
    angles: List[str] = []
    score = 0.0
    for name, terms, weight in (
        ("people", SOURCE_PEOPLE_TERMS, SOURCE_SCORE_PEOPLE),
        ("old_age", SOURCE_OLD_AGE_TERMS, SOURCE_SCORE_OLD_AGE),
        ("classic", SOURCE_CLASSIC_TERMS, SOURCE_SCORE_CLASSIC),
    ):
        hits = _hits(title, terms)
        if hits:
            score += weight
            angles.append(f"{name}: {', '.join(hits)}")
    if views:
        score += math.log10(views)
    return SourceCandidate(video_id="", title=title, views=views, score=round(score, 2), angles=angles)


def rank_candidates(entries: Iterable[Dict], cloned_ids: Set[str]) -> List[SourceCandidate]:
    ranked: List[SourceCandidate] = []
    for entry in entries:
        candidate = score_title(entry.get("title") or "", entry.get("view_count"))
        candidate.video_id = entry.get("id") or ""
        candidate.already_cloned = candidate.video_id in cloned_ids
        ranked.append(candidate)
    return sorted(ranked, key=lambda c: (c.already_cloned, -c.score))


def fetch_channel_videos(channel: str, limit: int) -> List[Dict]:
    """Flat listing of the channel's /videos tab (title, id, view_count); no API key needed."""
    from yt_dlp import YoutubeDL

    url = f"https://www.youtube.com/{channel}/videos"
    opts = {"quiet": True, "no_warnings": True, "extract_flat": True, "playlistend": limit}
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return [e for e in (info.get("entries") or []) if e and e.get("id")]


def cloned_source_ids_from_db() -> Set[str]:
    """source_video_id of every video already in the KO-JP DB; empty when the DB is down."""
    try:
        from build_metadata_kit import get_db_connection
        conn = get_db_connection()
    except Exception as err:  # the ranking is still useful without the DB
        print(f"[WARN] DB unavailable, cannot exclude already cloned videos from DB: {err}")
        return set()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT source_video_id FROM ko_jp_videos WHERE source_video_id IS NOT NULL")
            return {row[0] for row in cur.fetchall()}
    finally:
        conn.close()


def main(argv: Optional[List[str]] = None) -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Rank source-channel videos for cloning")
    parser.add_argument("--channel", default=SOURCE_CHANNEL_HANDLE)
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)

    cloned = ChannelRegistry.load().cloned_source_ids() | cloned_source_ids_from_db()
    ranked = rank_candidates(fetch_channel_videos(args.channel, args.limit), cloned)

    for i, c in enumerate(ranked, 1):
        flag = " (đã làm)" if c.already_cloned else ""
        print(f"{i:>2}. {c.score:>5.2f}  {c.views or 0:>7}  https://youtu.be/{c.video_id}  {c.title}{flag}")
        if c.angles:
            print(f"              {' | '.join(c.angles)}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps([c.model_dump() for c in ranked], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nSaved {len(ranked)} candidates to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
