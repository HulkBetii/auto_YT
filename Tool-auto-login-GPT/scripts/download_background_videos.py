"""Automated Background Video Downloader for Auto_YT / Nexus Studio.

Directly searches and downloads royalty-free 16:9 1080p+ videos from Pexels
using browser TLS impersonation (curl_cffi) to bypass Cloudflare without requiring an API key.
Automatically strips all audio via FFmpeg and saves files sequentially as video_1.mp4 ... video_2000.mp4.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from curl_cffi import requests

# Configure logging with UTF-8 support
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("stock_downloader")

# Keywords requested by user (Vietnam culture, landmarks, nature)
VIETNAM_KEYWORDS = [
    "vietnam",
    "hanoi",
    "saigon",
    "ho chi minh city",
    "da nang",
    "halong bay",
    "hoi an",
    "ninh binh",
    "sapa",
    "hue",
    "dalat",
    "phu quoc",
    "nha trang",
    "mekong delta",
    "cao bang",
    "ban gioc",
    "cat ba",
    "mui ne",
    "vietnam travel",
    "vietnam countryside",
    "vietnam drone",
    "vietnam landscape",
    "vietnam nature",
    "vietnam scenery",
    "vietnam beach",
    "vietnam street",
    "vietnam traffic",
    "vietnam street food",
    "vietnamese food",
    "vietnam temple",
    "vietnam pagoda",
    "vietnam farmer",
]

# Supplementary nature/drone keywords to guarantee reaching target count
SUPPLEMENTARY_KEYWORDS = [
    "southeast asia landscape",
    "asian countryside",
    "asian street market",
    "drone tropical landscape",
    "drone aerial nature",
    "mountain valley aerial",
    "waterfall slow motion",
    "sunset beach drone",
    "rice terrace drone",
    "bamboo forest drone",
    "calm river aerial",
    "misty mountains aerial",
    "countryside road drone",
    "ocean waves aerial 4k",
    "green forest drone flyover",
    "city timelapse night",
    "ancient temple aerial",
    "cloud timelapse 4k",
    "tropical island drone",
    "lush green nature",
    "aerial river landscape",
    "peaceful rural nature",
    "floating market",
    "tranquil lake drone",
]


def get_ffmpeg_path() -> str:
    """Locate ffmpeg binary on system or through imageio_ffmpeg."""
    sys_ffmpeg = shutil.which("ffmpeg")
    if sys_ffmpeg:
        return sys_ffmpeg

    try:
        import imageio_ffmpeg

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and Path(exe).exists():
            return exe
    except Exception:
        pass

    candidates = [
        Path(os.environ.get("LOCALAPPDATA", ""))
        / "Programs"
        / "Python"
        / "Python311"
        / "Lib"
        / "site-packages"
        / "imageio_ffmpeg"
        / "binaries"
        / "ffmpeg-win-x86_64-v7.1.exe",
    ]
    for c in candidates:
        if c.exists():
            return str(c)

    raise RuntimeError("Không tìm thấy FFmpeg trên hệ thống. Vui lòng cài đặt FFmpeg hoặc gói imageio-ffmpeg.")


def get_existing_video_numbers(output_dir: Path) -> set[int]:
    """Scan existing video_X.mp4 files and return set of existing integer IDs."""
    existing = set()
    for f in output_dir.glob("video_*.mp4"):
        m = re.match(r"^video_(\d+)\.mp4$", f.name)
        if m:
            existing.add(int(m.group(1)))
    return existing


def strip_audio_ffmpeg(ffmpeg_exe: str, input_file: Path, output_file: Path) -> bool:
    """Strip audio from video file using ffmpeg -c:v copy -an."""
    cmd = [
        ffmpeg_exe,
        "-y",
        "-v",
        "error",
        "-i",
        str(input_file),
        "-c:v",
        "copy",
        "-an",
        str(output_file),
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if res.returncode == 0 and output_file.exists() and output_file.stat().st_size > 1024:
            return True
        logger.error("FFmpeg error: %s", res.stderr)
        return False
    except Exception as e:
        logger.error("FFmpeg execution failed: %s", e)
        return False


def download_file(url: str, dest_path: Path, timeout: int = 120) -> bool:
    """Download file with stream chunks and timeout handling."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        },
    )
    temp_path = dest_path.with_suffix(".part")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response, open(temp_path, "wb") as out_file:
            shutil.copyfileobj(response, out_file)
        if temp_path.exists() and temp_path.stat().st_size > 1024:
            temp_path.replace(dest_path)
            return True
        return False
    except Exception as e:
        logger.warning("Download failed for %s: %s", url, e)
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
        return False


class PexelsScraperDownloader:
    def __init__(
        self,
        output_dir: Path,
        target_count: int = 2000,
        min_duration: int = 10,
        max_duration: int = 60,
    ):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.temp_dir = self.output_dir / "temp_incoming"
        self.temp_dir.mkdir(parents=True, exist_ok=True)

        self.target_count = target_count
        self.min_duration = min_duration
        self.max_duration = max_duration
        self.ffmpeg_exe = get_ffmpeg_path()

        self.meta_file = self.output_dir / "download_catalog.json"
        self.catalog = self._load_catalog()

    def _load_catalog(self) -> dict[str, Any]:
        if self.meta_file.exists():
            try:
                with open(self.meta_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"downloaded_source_ids": [], "items": {}}

    def _save_catalog(self) -> None:
        try:
            with open(self.meta_file, "w", encoding="utf-8") as f:
                json.dump(self.catalog, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning("Could not save catalog: %s", e)

    def search_pexels_page(self, query: str, page: int = 1) -> list[dict[str, Any]]:
        """Fetch search page using curl_cffi and parse video items from __NEXT_DATA__."""
        encoded_query = urllib.parse.quote(query)
        url = f"https://www.pexels.com/search/videos/{encoded_query}/?orientation=landscape&page={page}"

        impersonates = ["chrome120", "chrome124", "edge101"]
        for target in impersonates:
            try:
                resp = requests.get(
                    url,
                    impersonate=target,
                    headers={
                        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
                    },
                    timeout=25,
                )
                if resp.status_code == 200:
                    next_data_match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', resp.text, re.DOTALL)
                    if next_data_match:
                        data = json.loads(next_data_match.group(1))
                        items = data.get("props", {}).get("pageProps", {}).get("initialData", {}).get("data", [])
                        return items
                logger.warning("Pexels query '%s' page %d (%s) returned status %d. Retrying...", query, page, target, resp.status_code)
                time.sleep(1.5)
            except Exception as e:
                logger.warning("Error searching Pexels '%s' page %d (%s): %s", query, page, target, e)
                time.sleep(1.5)

        return []

    def select_best_video_file(self, item: dict[str, Any]) -> dict[str, Any] | None:
        """Find best 16:9 file >= 1080p."""
        attrs = item.get("attributes", {})
        video_obj = attrs.get("video", {})
        files = video_obj.get("video_files", []) or video_obj.get("files", [])
        if not files:
            return None

        candidates = []
        for f in files:
            w = f.get("width") or 0
            h = f.get("height") or 0
            link = f.get("link") or ""
            ftype = f.get("file_type") or "video/mp4"

            if not link or "video/mp4" not in ftype:
                continue

            # Must be landscape (width > height) and at least 1080p
            if w > h and w >= 1920 and h >= 1080:
                aspect = w / h
                if 1.6 <= aspect <= 1.9:
                    candidates.append((abs(w - 1920), w, link, w, h))

        if not candidates:
            return None

        # Sort so 1920x1080 is prioritized (diff 0), followed by 4K
        candidates.sort(key=lambda x: x[0])
        best = candidates[0]
        return {"link": best[2], "width": best[3], "height": best[4]}

    def run(self) -> None:
        existing_nums = get_existing_video_numbers(self.output_dir)
        downloaded_ids = set(self.catalog.get("downloaded_source_ids", []))

        current_index = 1
        while current_index in existing_nums:
            current_index += 1

        total_downloaded = len(existing_nums)
        logger.info(
            "Bắt đầu tải video nền Pexels: Đã có %d/%d video. Tiếp tục từ video_%d.mp4",
            total_downloaded,
            self.target_count,
            current_index,
        )

        all_keywords = VIETNAM_KEYWORDS + SUPPLEMENTARY_KEYWORDS

        for kw in all_keywords:
            if total_downloaded >= self.target_count:
                break

            logger.info("--> [Từ khóa: '%s'] Bắt đầu tìm kiếm...", kw)

            consecutive_empty_pages = 0
            for page in range(1, 30):
                if total_downloaded >= self.target_count:
                    break

                items = self.search_pexels_page(kw, page=page)
                if not items:
                    consecutive_empty_pages += 1
                    if consecutive_empty_pages >= 2:
                        break
                    time.sleep(1.0)
                    continue
                consecutive_empty_pages = 0

                page_downloads = 0
                for item in items:
                    if total_downloaded >= self.target_count:
                        break

                    item_id = str(item.get("id"))
                    source_id = f"pexels_{item_id}"
                    if source_id in downloaded_ids:
                        continue

                    attrs = item.get("attributes", {})
                    duration = attrs.get("duration", 0)
                    if not (self.min_duration <= duration <= self.max_duration):
                        continue

                    best_file = self.select_best_video_file(item)
                    if not best_file:
                        continue

                    download_url = best_file["link"]
                    while current_index in existing_nums:
                        current_index += 1

                    raw_temp = self.temp_dir / f"raw_temp_{current_index}.mp4"
                    final_target = self.output_dir / f"video_{current_index}.mp4"

                    logger.info(
                        "[%d/%d] Đang tải Pexels #%s (%ds, %dx%d) -> video_%d.mp4...",
                        total_downloaded + 1,
                        self.target_count,
                        item_id,
                        duration,
                        best_file["width"],
                        best_file["height"],
                        current_index,
                    )

                    ok = download_file(download_url, raw_temp)
                    if not ok:
                        continue

                    # Strip audio via FFmpeg
                    stripped_ok = strip_audio_ffmpeg(self.ffmpeg_exe, raw_temp, final_target)
                    raw_temp.unlink(missing_ok=True)

                    if stripped_ok:
                        existing_nums.add(current_index)
                        downloaded_ids.add(source_id)
                        total_downloaded += 1
                        page_downloads += 1

                        self.catalog["downloaded_source_ids"].append(source_id)
                        self.catalog["items"][f"video_{current_index}.mp4"] = {
                            "source": "pexels",
                            "source_id": item_id,
                            "url": f"https://www.pexels.com/video/{item_id}/",
                            "duration": duration,
                            "width": best_file["width"],
                            "height": best_file["height"],
                            "keyword": kw,
                        }
                        self._save_catalog()

                        logger.info("  => Xong video_%d.mp4 (Đã tắt tiếng)", current_index)
                        current_index += 1
                    else:
                        logger.warning("  => Lỗi FFmpeg với video_%d.mp4", current_index)

                # Short polite delay to avoid aggressive flooding
                time.sleep(1.0)

        logger.info(
            "=== HOÀN TẤT: Đã tải và xử lý tổng cộng %d video vào %s ===",
            total_downloaded,
            self.output_dir,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Tải kho video nền 1080p 16:9 từ Pexels cho Auto_YT.")
    parser.add_argument("--target-count", type=int, default=1000, help="Số lượng video cần tải (mặc định 1000)")
    parser.add_argument("--min-duration", type=int, default=10, help="Thời lượng tối thiểu (giây)")
    parser.add_argument("--max-duration", type=int, default=60, help="Thời lượng tối đa (giây)")
    parser.add_argument(
        "--output-dir",
        type=str,
        default=r"D:\VibeCoding\auto_upload\Nexus\Tool-auto-login-GPT\data\background_videos",
        help="Thư mục lưu video",
    )

    args = parser.parse_args()

    downloader = PexelsScraperDownloader(
        output_dir=Path(args.output_dir),
        target_count=args.target_count,
        min_duration=args.min_duration,
        max_duration=args.max_duration,
    )
    downloader.run()


if __name__ == "__main__":
    main()
