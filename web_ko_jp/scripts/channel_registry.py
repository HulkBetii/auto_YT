"""
channel_registry.py
===================
JSON registry of what the channel shipped and which videos YouTube suggested it next to.

Why: titles came from five fixed formulas with no memory of earlier uploads, so titles drift
towards near-duplicates; and the only evidence of who the audience is (Studio "Suggested videos"
sources) lived in CSV exports nobody read. The registry feeds title dedup and source picking.

CLI (run from repo root):
    uv run python web_ko_jp/scripts/channel_registry.py import-content-csv "<Studio Content export dir>"
    uv run python web_ko_jp/scripts/channel_registry.py import-suggested-csv "<Traffic source export dir>" --for <youtube_id> [--resolve-channels]
    uv run python web_ko_jp/scripts/channel_registry.py show
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Dict, Iterable, List, Literal, Optional, Set

from pydantic import BaseModel, Field, PrivateAttr

logger = logging.getLogger(__name__)

DEFAULT_REGISTRY_PATH = Path(__file__).resolve().parents[1] / "data" / "channel_registry.json"
CSV_FILENAME = "Table data.csv"
SUGGESTED_PREFIX = "YT_RELATED."
DEFAULT_RESOLVE_LIMIT = 10


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def _int(value: str) -> Optional[int]:
    value = (value or "").strip().replace(",", "")
    return int(float(value)) if value else None


def _float(value: str) -> Optional[float]:
    value = (value or "").strip().replace(",", "")
    return float(value) if value else None


def _csv_rows(path: Path) -> List[Dict[str, str]]:
    """Accepts the export folder or the CSV itself; skips the 'Total' row."""
    csv_path = path / CSV_FILENAME if path.is_dir() else path
    if not csv_path.is_file():
        raise FileNotFoundError(f"Studio export not found: {csv_path}")
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    first_col = next(iter(rows[0])) if rows else ""
    return [r for r in rows if (r.get(first_col) or "").strip() != "Total"]


class PublishedVideo(BaseModel):
    video_id: str = ""                     # YouTube id; empty for kits not uploaded yet
    title: str
    chapters: List[str] = Field(default_factory=list)
    publish_time: str = ""
    impressions: Optional[int] = None
    ctr: Optional[float] = None
    views: Optional[int] = None
    watch_hours: Optional[float] = None
    db_video_id: Optional[int] = None      # ko_jp_videos.id for kit entries
    source_video_id: str = ""              # cloned VN video
    origin: Literal["studio_csv", "upload_kit"]
    recorded_at: str = Field(default_factory=_now)


class HostVideo(BaseModel):
    """A video YouTube showed ours next to (Studio > Traffic source > Suggested videos)."""
    video_id: str
    title: str
    channel: str = ""
    for_video: str                          # our YouTube id
    impressions: Optional[int] = None
    ctr: Optional[float] = None
    views: Optional[int] = None
    watch_hours: Optional[float] = None
    recorded_at: str = Field(default_factory=_now)


class ChannelRegistry(BaseModel):
    videos: List[PublishedVideo] = Field(default_factory=list)
    hosts: List[HostVideo] = Field(default_factory=list)
    _path: Path = PrivateAttr(default=DEFAULT_REGISTRY_PATH)

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "ChannelRegistry":
        path = Path(path or DEFAULT_REGISTRY_PATH)
        registry = cls.model_validate_json(path.read_text(encoding="utf-8")) if path.is_file() else cls()
        registry._path = path
        return registry

    def save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self._path)

    # ------------------------------------------------------------------ imports

    def import_content_csv(self, path: Path) -> int:
        """Studio > Analytics > Content export (channel level, one row per video)."""
        count = 0
        for row in _csv_rows(Path(path)):
            video_id, title = (row.get("Content") or "").strip(), (row.get("Video title") or "").strip()
            if not video_id or not title:
                continue
            entry = PublishedVideo(
                video_id=video_id,
                title=title,
                publish_time=(row.get("Video publish time") or "").strip(),
                impressions=_int(row.get("Thumbnail impressions", "")),
                ctr=_float(row.get("Thumbnail click-through rate (%)", "")),
                views=_int(row.get("Views", "")),
                watch_hours=_float(row.get("Watch time (hours)", "")),
                origin="studio_csv",
            )
            existing = next((v for v in self.videos if v.origin == "studio_csv" and v.video_id == video_id), None)
            if existing:
                entry.chapters = existing.chapters
                self.videos[self.videos.index(existing)] = entry
            else:
                self.videos.append(entry)
            count += 1
        return count

    def import_suggested_csv(self, path: Path, for_video: str) -> int:
        """Studio > Traffic source > Suggested videos export for one of our videos."""
        count = 0
        for row in _csv_rows(Path(path)):
            source = (row.get("Traffic source") or "").strip()
            if not source.startswith(SUGGESTED_PREFIX):
                continue
            host = HostVideo(
                video_id=source[len(SUGGESTED_PREFIX):],
                title=(row.get("Source title") or "").strip(),
                for_video=for_video,
                impressions=_int(row.get("Thumbnail impressions", "")),
                ctr=_float(row.get("Thumbnail click-through rate (%)", "")),
                views=_int(row.get("Views", "")),
                watch_hours=_float(row.get("Watch time (hours)", "")),
            )
            existing = next(
                (h for h in self.hosts if h.video_id == host.video_id and h.for_video == for_video), None
            )
            if existing:
                host.channel = existing.channel
                self.hosts[self.hosts.index(existing)] = host
            else:
                self.hosts.append(host)
            count += 1
        return count

    def resolve_host_channels(self, limit: int = DEFAULT_RESOLVE_LIMIT) -> int:
        """Fills HostVideo.channel for the top hosts by impressions (one yt-dlp metadata call each)."""
        from yt_dlp import YoutubeDL

        pending = [h for h in self.top_hosts() if not h.channel][:limit]
        resolved = 0
        with YoutubeDL({"quiet": True, "skip_download": True, "no_warnings": True}) as ydl:
            for host in pending:
                try:
                    info = ydl.extract_info(f"https://www.youtube.com/watch?v={host.video_id}", download=False)
                except Exception as err:  # one unavailable video must not stop the rest
                    logger.warning("Could not resolve channel for %s: %s", host.video_id, err)
                    continue
                host.channel = info.get("channel") or info.get("uploader") or ""
                resolved += 1
        return resolved

    def record_kit(
        self, title: str, chapters: List[str], db_video_id: int, source_video_id: str = ""
    ) -> None:
        """Records the title an upload kit ships (replaces the previous kit of the same DB video)."""
        self.videos = [v for v in self.videos if not (v.origin == "upload_kit" and v.db_video_id == db_video_id)]
        self.videos.append(PublishedVideo(
            title=title, chapters=chapters, db_video_id=db_video_id,
            source_video_id=source_video_id, origin="upload_kit",
        ))

    # ------------------------------------------------------------------ queries

    def titles_for_dedup(
        self, exclude_db_video_id: Optional[int] = None, own_titles: Iterable[str] = ()
    ) -> List[str]:
        """Titles a new title must not resemble. A re-run of one kit is not its own duplicate,
        including after that kit was uploaded and re-imported from Studio under the same title
        (`own_titles`: the titles this DB video already carries)."""
        own_titles = {t for t in own_titles if t}
        if exclude_db_video_id is not None:
            own_titles |= {
                v.title for v in self.videos if v.origin == "upload_kit" and v.db_video_id == exclude_db_video_id
            }
        return [
            v.title for v in self.videos
            if not (v.origin == "upload_kit" and v.db_video_id == exclude_db_video_id) and v.title not in own_titles
        ]

    def chapter_names_for_dedup(self) -> List[str]:
        return [c for v in self.videos for c in v.chapters]

    def cloned_source_ids(self) -> Set[str]:
        return {v.source_video_id for v in self.videos if v.source_video_id}

    def top_hosts(self) -> List[HostVideo]:
        return sorted(self.hosts, key=lambda h: (h.impressions or 0, h.views or 0), reverse=True)

    def host_titles(self) -> List[str]:
        return [h.title for h in self.top_hosts()]


def _print_summary(registry: ChannelRegistry, hosts: Iterable[HostVideo]) -> None:
    for v in registry.videos:
        print(f"[{v.origin}] {v.video_id or f'db#{v.db_video_id}'} impr={v.impressions} ctr={v.ctr} | {v.title}")
    print("--- top suggested hosts ---")
    for h in list(hosts)[:15]:
        print(f"{h.video_id} impr={h.impressions} views={h.views} ch={h.channel or '?'} | {h.title[:60]}")


def main(argv: Optional[List[str]] = None) -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Channel registry for 人生の真理")
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY_PATH)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_content = sub.add_parser("import-content-csv")
    p_content.add_argument("path", type=Path)
    p_sugg = sub.add_parser("import-suggested-csv")
    p_sugg.add_argument("path", type=Path)
    p_sugg.add_argument("--for", dest="for_video", required=True, help="our YouTube video id")
    p_sugg.add_argument("--resolve-channels", action="store_true")
    p_sugg.add_argument("--resolve-limit", type=int, default=DEFAULT_RESOLVE_LIMIT)
    sub.add_parser("show")
    args = parser.parse_args(argv)

    registry = ChannelRegistry.load(args.registry)
    if args.cmd == "import-content-csv":
        print(f"Imported {registry.import_content_csv(args.path)} videos.")
        registry.save()
    elif args.cmd == "import-suggested-csv":
        print(f"Imported {registry.import_suggested_csv(args.path, args.for_video)} suggested hosts.")
        if args.resolve_channels:
            print(f"Resolved {registry.resolve_host_channels(args.resolve_limit)} host channels.")
        registry.save()
    _print_summary(registry, registry.top_hosts())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
