"""
Download CC0 / Public Domain / Royalty-Free Ambience, SFX, and BGM assets for Story Drama Pipeline
"""
import urllib.request
import os
import sys
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("audio_asset_downloader")

BASE_DATA = Path("web_vn/data").resolve()
SFX_DIR = BASE_DATA / "sfx"
BGM_DIR = BASE_DATA / "bgm"

AUDIO_RESOURCES = {
    # ── Ambience Beds ────────────────────────────────────────────────────────
    "sfx/ambience/rain_night_gentle.ogg": "https://upload.wikimedia.org/wikipedia/commons/2/23/Sound_of_rain_falling_on_ground.ogg",
    "sfx/ambience/night_crickets_countryside.ogg": "https://upload.wikimedia.org/wikipedia/commons/e/ec/Crickets_at_night.ogg",
    "sfx/ambience/wind_in_trees.ogg": "https://upload.wikimedia.org/wikipedia/commons/0/07/Wind_in_trees.ogg",
    
    # ── Cinematic SFX Stingers ───────────────────────────────────────────────
    "sfx/transitions/sub_bass_drop.ogg": "https://upload.wikimedia.org/wikipedia/commons/8/87/Low_Frequency_Rumble.ogg",
    "sfx/transitions/page_turn.ogg": "https://upload.wikimedia.org/wikipedia/commons/6/6f/Page_turn.ogg",
    "sfx/transitions/thunder_distant.ogg": "https://upload.wikimedia.org/wikipedia/commons/5/5a/Thunder_rolling.ogg",

    # ── Classical Sad / Melancholic Piano & Strings (Public Domain) ─────────
    # Beethoven - Moonlight Sonata (Adagio sostenuto - Classic Dark Drama)
    "bgm/sad_piano/moonlight_sonata_adagio.mp3": "https://upload.wikimedia.org/wikipedia/commons/e/eb/Beethoven_Moonlight_1st_movement.ogg",
    # Chopin - Nocturne in C Minor (Deep emotional sadness)
    "bgm/sad_piano/chopin_nocturne_c_minor.ogg": "https://upload.wikimedia.org/wikipedia/commons/d/d3/Chopin_Nocturne_in_C_minor%2C_Op._48%2C_No._1.ogg",
    # Erik Satie - Gymnopedie No. 1 (Thoughtful, nostalgic, reflective)
    "bgm/sad_piano/satie_gymnopedie_no1.ogg": "https://upload.wikimedia.org/wikipedia/commons/b/ba/Satie_-_Gymnopedie_No_1.ogg",
    # Chopin - Prelude in E Minor Op. 28 No. 4 (Melancholic sorrow)
    "bgm/sad_piano/chopin_prelude_e_minor.ogg": "https://upload.wikimedia.org/wikipedia/commons/9/94/Frederic_Chopin_-_prelude_no._4_in_e_minor%2C_op._28.ogg",
    # Bach - Air on G String (Emotional strings drama)
    "bgm/suspense/bach_air_on_g_string.ogg": "https://upload.wikimedia.org/wikipedia/commons/6/6d/Air_on_the_G_String_%28Suite_No._3_in_D%2C_BWV_1068%29.ogg",
    # Schubert - Serenade (Ständchen - Romantic melancholy)
    "bgm/sad_piano/schubert_serenade.ogg": "https://upload.wikimedia.org/wikipedia/commons/e/e0/Schubert_-_St%C3%A4ndchen_%28Serenade%29.ogg"
}

def download_audio_assets():
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    success = 0
    for rel_path, url in AUDIO_RESOURCES.items():
        out_file = BASE_DATA / rel_path
        out_file.parent.mkdir(parents=True, exist_ok=True)
        if out_file.exists() and out_file.stat().st_size > 5000:
            logger.info(f"✅ Exists: {rel_path} ({out_file.stat().st_size:,} bytes)")
            success += 1
            continue
        try:
            logger.info(f"⬇️ Downloading: {rel_path}...")
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp, open(out_file, "wb") as f:
                f.write(resp.read())
            logger.info(f"  Saved {rel_path} ({out_file.stat().st_size:,} bytes)")
            success += 1
        except Exception as e:
            logger.warning(f"  Failed {rel_path}: {e}")

    logger.info(f"🎉 Downloaded {success}/{len(AUDIO_RESOURCES)} audio assets.")

if __name__ == "__main__":
    download_audio_assets()
