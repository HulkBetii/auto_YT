"""
Download essential Vietnamese Google Fonts directly from GitHub / Google Fonts raw repos
"""
import urllib.request
import os
import sys
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("font_downloader")

FONTS_DIR = Path("web_vn/data/fonts").resolve()
FONTS_DIR.mkdir(parents=True, exist_ok=True)

FONT_URLS = {
    # Be Vietnam Pro
    "BeVietnamPro-Regular.ttf": "https://github.com/google/fonts/raw/main/ofl/bevietnampro/BeVietnamPro-Regular.ttf",
    "BeVietnamPro-Medium.ttf": "https://github.com/google/fonts/raw/main/ofl/bevietnampro/BeVietnamPro-Medium.ttf",
    "BeVietnamPro-SemiBold.ttf": "https://github.com/google/fonts/raw/main/ofl/bevietnampro/BeVietnamPro-SemiBold.ttf",
    "BeVietnamPro-Bold.ttf": "https://github.com/google/fonts/raw/main/ofl/bevietnampro/BeVietnamPro-Bold.ttf",
    # Montserrat
    "Montserrat-Regular.ttf": "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf",
    # Playfair Display (Title / Chapter Header)
    "PlayfairDisplay-Bold.ttf": "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay%5Bital%2Copsz%2Cwght%5D.ttf",
    # Quicksand
    "Quicksand-Bold.ttf": "https://github.com/google/fonts/raw/main/ofl/quicksand/Quicksand%5Bwght%5D.ttf",
    # Lexend Deca
    "LexendDeca-SemiBold.ttf": "https://github.com/google/fonts/raw/main/ofl/lexenddeca/LexendDeca%5Bwght%5D.ttf",
}

def download_fonts():
    headers = {"User-Agent": "Mozilla/5.0"}
    success_count = 0
    for name, url in FONT_URLS.items():
        out_path = FONTS_DIR / name
        if out_path.exists() and out_path.stat().st_size > 1000:
            logger.info(f"✅ Exists: {name} ({out_path.stat().st_size:,} bytes)")
            success_count += 1
            continue
        try:
            logger.info(f"⬇️ Downloading: {name} from {url}...")
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp, open(out_path, "wb") as f:
                f.write(resp.read())
            logger.info(f"  Saved {name} ({out_path.stat().st_size:,} bytes)")
            success_count += 1
        except Exception as e:
            logger.warning(f"  Failed {name}: {e}")

    logger.info(f"🎉 Downloaded {success_count}/{len(FONT_URLS)} fonts to {FONTS_DIR}")

if __name__ == "__main__":
    download_fonts()
