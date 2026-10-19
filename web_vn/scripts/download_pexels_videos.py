# -*- coding: utf-8 -*-
"""
Automated Pexels Stock Video Downloader v2.0
Collects and downloads high-quality 1080p Full HD landscape stock video clips
from Pexels for background video loops in YouTube Audio Drama.
"""

import sys
import os
import re
import json
import time
import urllib.request
import urllib.parse
import argparse
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Set
from concurrent.futures import ThreadPoolExecutor, as_completed
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("pexels_downloader")

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT_DIR = REPO_ROOT / "web_vn" / "data" / "background_videos" / "traffic_night"

TRAFFIC_NIGHT_QUERIES = [
    "traffic night",
    "night driving",
    "highway night traffic",
    "city lights traffic",
    "rain night traffic",
    "street traffic night",
    "driving rain night",
    "city traffic dark",
    "car headlights night",
    "road night drive",
    "car interior night drive",
    "city highway night",
    "bridge traffic night"
]


def extract_best_hd_mp4(html_source: str, video_id: str) -> Optional[str]:
    """
    Extracts the optimal landscape HD MP4 URL (1080p > 720p > 1440p > 2160p) for a specific video ID.
    Avoids vertical (portrait) video files.
    """
    pattern = rf'https://videos\.pexels\.com/video-files/{video_id}/[^"\', ]+\.mp4'
    matches = list(set(re.findall(pattern, html_source)))

    if not matches:
        matches = list(set(re.findall(r'https://videos\.pexels\.com/video-files/[^"\', ]+\.mp4', html_source)))

    if not matches:
        return None

    # Filter out portrait aspect ratios
    landscape_matches = [
        m for m in matches
        if not re.search(r'_(?:1080_1920|720_1280|540_960|360_640|240_426)_', m)
    ]
    pool = landscape_matches if landscape_matches else matches

    def score_url(url: str) -> int:
        u_low = url.lower()
        if "1920_1080" in u_low or "hd_1920" in u_low:
            return 100
        if "1280_720" in u_low or "hd_1280" in u_low:
            return 90
        if "2560_1440" in u_low:
            return 85
        if "3840_2160" in u_low:
            return 80
        if "960_540" in u_low or "sd_960" in u_low:
            return 70
        if "640_360" in u_low:
            return 50
        return 10

    ranked = sorted(pool, key=score_url, reverse=True)
    return ranked[0] if ranked else None


def harvest_video_items(queries: List[str] = TRAFFIC_NIGHT_QUERIES, target_count: int = 100) -> List[Dict[str, Any]]:
    """
    Harvests target_count unique landscape video items and direct CDN URLs from Pexels across queries.
    """
    harvested = {}
    logger.info(f"Launching Playwright to harvest {target_count} landscape videos across {len(queries)} queries...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for q in queries:
            if len(harvested) >= target_count:
                break

            q_enc = urllib.parse.quote(q)
            search_url = f"https://www.pexels.com/vi-vn/tim-kiem/videos/{q_enc}/?orientation=landscape"
            logger.info(f"Scraping Query '{q}': {search_url}")

            try:
                context = browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                )
                page = context.new_page()
                page.goto(search_url, wait_until="domcontentloaded", timeout=25000)
                page.wait_for_timeout(2000)

                html_source = page.content()

                video_links = page.eval_on_selector_all(
                    'a[href*="/video/"]',
                    'els => [...new Set(els.map(e => e.href))]'
                )

                page_video_ids = []
                for link in video_links:
                    m = re.search(r'/video/[^/]*?-?(\d+)/?', link)
                    if m:
                        v_id = m.group(1)
                        if v_id not in harvested and v_id not in page_video_ids:
                            page_video_ids.append(v_id)

                for v_id in page_video_ids:
                    if len(harvested) >= target_count:
                        break

                    best_mp4 = extract_best_hd_mp4(html_source, v_id)
                    if best_mp4:
                        harvested[v_id] = {
                            "video_id": v_id,
                            "query": q,
                            "source_page": f"https://www.pexels.com/vi-vn/video/{v_id}/",
                            "download_url": best_mp4
                        }

                # Check detail pages if MP4 wasn't in search page source
                remaining_ids = [vid for vid in page_video_ids if vid not in harvested]
                for v_id in remaining_ids:
                    if len(harvested) >= target_count:
                        break
                    detail_url = f"https://www.pexels.com/vi-vn/video/{v_id}/"
                    try:
                        page.goto(detail_url, wait_until="domcontentloaded", timeout=15000)
                        detail_html = page.content()
                        best_mp4 = extract_best_hd_mp4(detail_html, v_id)
                        if best_mp4:
                            harvested[v_id] = {
                                "video_id": v_id,
                                "query": q,
                                "source_page": detail_url,
                                "download_url": best_mp4
                            }
                    except Exception:
                        pass

                context.close()
                logger.info(f"Progress: {len(harvested)} / {target_count} videos harvested.")

            except Exception as e:
                logger.warning(f"Error scraping query '{q}': {e}")

        browser.close()

    result = list(harvested.values())[:target_count]
    logger.info(f"✅ Harvested {len(result)} direct download video URLs.")
    return result


def download_single_video(item: Dict[str, Any], output_file: Path) -> bool:
    """Downloads a single video file from Pexels CDN."""
    if output_file.exists() and output_file.stat().st_size > 100000:
        logger.info(f"Reusing existing video: {output_file.name}")
        return True

    url = item["download_url"]
    temp_file = output_file.parent / f"tmp_{output_file.name}"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.pexels.com/"
    }

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=45) as response, open(temp_file, "wb") as out:
            chunk_size = 64 * 1024
            while True:
                chunk = response.read(chunk_size)
                if not chunk:
                    break
                out.write(chunk)

        if temp_file.exists() and temp_file.stat().st_size > 100000:
            temp_file.replace(output_file)
            logger.info(f"✅ Downloaded: {output_file.name} ({output_file.stat().st_size / (1024*1024):.2f} MB)")
            return True
        else:
            if temp_file.exists():
                temp_file.unlink()
            return False
    except Exception as e:
        logger.error(f"Failed to download {output_file.name} from {url}: {e}")
        if temp_file.exists():
            temp_file.unlink()
        return False


def batch_download_pexels_videos(
    target_count: int = 100,
    output_dir: Path = DEFAULT_OUT_DIR,
    max_workers: int = 10
) -> List[Path]:
    """
    Orchestrates harvesting and downloading of target_count videos into output_dir.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    index_file = output_dir / "index.json"

    # Step 1: Harvest URLs
    items = harvest_video_items(queries=TRAFFIC_NIGHT_QUERIES, target_count=target_count)

    # Step 2: Parallel Batch Download
    logger.info(f"Starting parallel download of {len(items)} videos with {max_workers} threads...")
    downloaded_files = []
    metadata_list = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_item = {}
        for idx, item in enumerate(items, start=1):
            out_filename = f"traffic_night_{idx:03d}.mp4"
            out_path = output_dir / out_filename
            item["local_filename"] = out_filename
            item["local_path"] = str(out_path)
            future = executor.submit(download_single_video, item, out_path)
            future_to_item[future] = (item, out_path)

        for future in as_completed(future_to_item):
            item, out_path = future_to_item[future]
            try:
                success = future.result()
                if success:
                    downloaded_files.append(out_path)
                    metadata_list.append(item)
            except Exception as e:
                logger.error(f"Exception downloading {out_path.name}: {e}")

    # Save index.json metadata
    index_file.write_text(json.dumps(metadata_list, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info(f"🎉 Successfully downloaded {len(downloaded_files)} / {len(items)} videos to: {output_dir}")
    logger.info(f"Saved metadata registry to: {index_file}")

    return downloaded_files


def main():
    parser = argparse.ArgumentParser(description="Pexels Stock Video Downloader v2.0")
    parser.add_argument("--count", type=int, default=100, help="Number of videos to download")
    parser.add_argument("--out-dir", type=str, default=str(DEFAULT_OUT_DIR), help="Output directory")
    parser.add_argument("--workers", type=int, default=10, help="Max parallel download threads")
    args = parser.parse_args()

    batch_download_pexels_videos(
        target_count=args.count,
        output_dir=Path(args.out_dir),
        max_workers=args.workers
    )


if __name__ == "__main__":
    main()
