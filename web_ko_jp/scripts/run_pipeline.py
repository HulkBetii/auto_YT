"""
run_pipeline.py
===============
Master Unified 1-Command Orchestrator for web_ko_jp video generation.
Automates 100% of the workflow from raw YouTube URL to 6 finalized assets + Upload Kit.

Usage:
    uv run python web_ko_jp/scripts/run_pipeline.py "https://www.youtube.com/watch?v=..."
    uv run python web_ko_jp/scripts/run_pipeline.py "https://www.youtube.com/watch?v=..." --skip-tts
"""
import sys
import os
import json
import re
import time
import shutil
import argparse
import asyncio
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parents[2]
BASE_DIR = REPO_ROOT / "web_ko_jp"
SRC_DIR = REPO_ROOT / "src"
SCRIPTS_DIR = BASE_DIR / "scripts"
OUTPUT_BASE = BASE_DIR / "output"

for p in [str(SRC_DIR), str(SCRIPTS_DIR)]:
    if p not in sys.path:
        sys.path.insert(0, p)

import psycopg2
from youtube_extractor import extract_youtube_info
from chatgpt_drama_pipeline import execute_full_drama_workflow
from timestamp_sync import extract_raw_chapter_lines, format_timestamp, sync_chapters_detailed
from tts_gpt_sovits import GPT_SOVITS_PY


def get_db_connection():
    """Connect to auto_yt_ko_jp Postgres container via local port 5437."""
    return psycopg2.connect(
        host="localhost",
        port=5437,
        database="auto_yt_ko_jp",
        user="postgres",
        password="postgres",
    )


def slugify(title: str, max_words: int = 6, max_chars: int = 35) -> str:
    """Generates a clean ASCII slug for directory names."""
    import unicodedata
    if not title:
        return "video"
    text = unicodedata.normalize("NFKD", title)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.replace("đ", "d").replace("Đ", "D")
    text = re.sub(r"[^\w]+", "_", text)
    parts = [p for p in text.split("_") if p]
    if len(parts) > max_words:
        text = "_".join(parts[:max_words])
    if len(text) > max_chars:
        text = text[:max_chars].rstrip("_")
    return text or "video"


def run_command_live(cmd: list, cwd: Path, step_name: str) -> None:
    """Runs a subprocess command with real-time stdout streaming."""
    print(f"\n[{step_name}] Running: {' '.join(str(c) for c in cmd)}")
    res = subprocess.run(cmd, cwd=str(cwd), text=True, encoding="utf-8")
    if res.returncode != 0:
        raise RuntimeError(f"[{step_name}] Failed with return code {res.returncode}")


async def run_master_pipeline(
    youtube_url: str,
    skip_tts: bool = False,
    generate_image: bool = True
) -> Dict[str, Any]:
    start_time = time.time()
    print("=" * 80)
    print("🚀 STARTING AUTO_YT JAPANESE DRAMA MASTER PIPELINE (8 STAGES)")
    print(f"Target URL: {youtube_url}")
    print("=" * 80)

    # -------------------------------------------------------------------------
    # STAGE 1: Extract YouTube Metadata & Transcript
    # -------------------------------------------------------------------------
    print("\n[STAGE 1/8] Extracting YouTube metadata and transcript...")
    yt_data = extract_youtube_info(youtube_url)
    source_title = yt_data["title"]
    source_video_id = yt_data["video_id"]
    source_url = yt_data["url"]
    transcript = yt_data["transcript"]
    duration_sec = yt_data.get("duration_seconds", 0)

    print(f"  Title: {source_title}")
    print(f"  Video ID: {source_video_id}")
    print(f"  Transcript lines: {len(transcript.splitlines())}")

    # -------------------------------------------------------------------------
    # STAGE 2: Execute 5-Turn Playwright ChatGPT Session
    # -------------------------------------------------------------------------
    print("\n[STAGE 2/8] Executing 5-Turn Playwright ChatGPT Session on PROFILE_GPT_1...")
    ai_result = await execute_full_drama_workflow(
        title=source_title,
        url=source_url,
        transcript=transcript,
        generate_image=generate_image,
        synthesize_audio=False,  # Audio will be synthesized in Stage 4 via dedicated bridge
    )

    title_primary = ai_result["title_jp"]
    title_a_jp = ai_result.get("title_a_jp") or title_primary
    title_b_jp = ai_result.get("title_b_jp") or ""
    title_c_jp = ai_result.get("title_c_jp") or ""
    script_jp = ai_result["script_jp"]
    description_jp = ai_result["description_jp"]
    youtube_tags = ai_result["youtube_tags"]
    tags_tiered = ai_result.get("tags_tiered") or {}
    pinned_comment = ai_result.get("pinned_comment") or ""
    thumbnail_text = ai_result["thumbnail_text"]
    thumbnail_options = ai_result.get("thumbnail_options") or []
    thumbnail_image_url = ai_result.get("thumbnail_image_url")
    conversation_url = ai_result.get("conversation_url")

    print(f"  ✅ Turn 1 (Script): {len(script_jp)} chars")
    print(f"  ✅ Turn 2 (Title A): {title_a_jp}")
    print(f"  ✅ Turn 3 (Description): {len(description_jp)} chars | Tags: {len(youtube_tags.split(','))} tags")
    print(f"  ✅ Turn 4 (Thumb Text): {thumbnail_text.replace(chr(10), ' / ')}")
    print(f"  ✅ Turn 5 (Thumbnail Image): {thumbnail_image_url}")

    # -------------------------------------------------------------------------
    # STAGE 3: Persist Video Record into PostgreSQL Database
    # -------------------------------------------------------------------------
    print("\n[STAGE 3/8] Persisting video record to PostgreSQL (ko_jp_videos)...")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ko_jp_videos (
                    source_url, source_title, source_video_id,
                    source_language, target_language, adaptation_mode,
                    title_jp, description_jp, thumbnail_text,
                    thumbnail_image_url, conversation_url,
                    final_script_jp, status, created_at, updated_at
                ) VALUES (
                    %s, %s, %s,
                    'vi', 'jp', 'philosophical_insight',
                    %s, %s, %s,
                    %s, %s,
                    %s, 'ready', NOW(), NOW()
                ) RETURNING id;
            """, (
                source_url, source_title, source_video_id,
                title_primary, description_jp, thumbnail_text,
                thumbnail_image_url, conversation_url,
                script_jp
            ))
            video_id = cur.fetchone()[0]
            conn.commit()
            print(f"  ✅ Saved record into DB with Video ID: {video_id}")
    finally:
        conn.close()

    # Define Target Output Folder
    slug = slugify(source_title)
    folder_name = f"v{video_id}_{source_video_id}_{slug}"
    video_out_dir = OUTPUT_BASE / folder_name
    video_out_dir.mkdir(parents=True, exist_ok=True)
    print(f"  Output folder: {video_out_dir}")

    audio_file = video_out_dir / f"drama_{folder_name}.wav"
    srt_file = video_out_dir / f"sub_{folder_name}.srt"
    thumb_file = video_out_dir / f"thumb_{folder_name}.png"
    data_json_file = video_out_dir / f"data_{folder_name}.json"
    summary_txt_file = video_out_dir / f"summary_{folder_name}.txt"
    kit_txt_file = video_out_dir / f"youtube_upload_kit_v{video_id}.txt"

    audio_duration_actual = None
    chapter_sync: list = []

    if not skip_tts:
        # ---------------------------------------------------------------------
        # STAGE 4: Synthesize Japanese Narration Audio via GPT-SoVITS
        # ---------------------------------------------------------------------
        print("\n[STAGE 4/8] Synthesizing Japanese Drama Voice via GPT-SoVITS...")
        tts_script = SCRIPTS_DIR / "tts_gpt_sovits.py"
        run_command_live(
            ["uv", "run", "python", str(tts_script), "--video_id", str(video_id)],
            REPO_ROOT,
            "STAGE 4 TTS"
        )

        # Move generated audio to output folder if needed
        public_audio = BASE_DIR / "public" / "audio" / f"drama_v{video_id}_{source_video_id}.wav"
        if not public_audio.exists():
            candidates = list((BASE_DIR / "public" / "audio").glob(f"drama_v{video_id}_*.wav"))
            if candidates:
                public_audio = candidates[0]
        if public_audio.exists() and public_audio != audio_file:
            shutil.copy2(public_audio, audio_file)

        # ---------------------------------------------------------------------
        # STAGE 5: Generate Subtitles (.srt) via faster-whisper GPU
        # ---------------------------------------------------------------------
        print("\n[STAGE 5/8] Generating Synchronized Subtitles (.srt) via Whisper GPU...")
        # tts_gpt_sovits.py already writes sub_*.srt next to the audio; regenerating it needs
        # faster_whisper, which the uv env lacks (v7 run died here after a finished TTS).
        if srt_file.exists():
            print(f"  ✅ SRT already produced by the TTS stage: {srt_file.name}")
        else:
            srt_script = SCRIPTS_DIR / "generate_srt.py"
            run_command_live(
                ["uv", "run", "python", str(srt_script), "--video_id", str(video_id)],
                REPO_ROOT,
                "STAGE 5 Whisper SRT"
            )

        public_srt = BASE_DIR / "public" / "subtitles" / f"sub_v{video_id}_{source_video_id}.srt"
        if public_srt.exists() and public_srt != srt_file:
            shutil.copy2(public_srt, srt_file)

        # ---------------------------------------------------------------------
        # STAGE 6: Synchronize Chapter Timestamps from .srt into Description
        # ---------------------------------------------------------------------
        print("\n[STAGE 6/8] Synchronizing Chapter Timestamps from .srt...")
        if srt_file.exists():
            updated_desc, chapter_sync = sync_chapters_detailed(description_jp, srt_file)
            if updated_desc:
                description_jp = updated_desc
                print(f"  ✅ Synchronized {len(chapter_sync)} chapters with audio timeline:")
                for ch in chapter_sync:
                    print(f"     {format_timestamp(ch['seconds'])} {ch['title']} [{ch['source']}]")

                # Update DB with synced description
                conn = get_db_connection()
                try:
                    with conn.cursor() as cur:
                        cur.execute("UPDATE ko_jp_videos SET description_jp = %s, updated_at = NOW() WHERE id = %s", (description_jp, video_id))
                        conn.commit()
                finally:
                    conn.close()

        # ---------------------------------------------------------------------
        # STAGE 6b: Voice QA — raw ASR vs script (the SRT is the script itself, so it cannot tell)
        # ---------------------------------------------------------------------
        print("\n[STAGE 6b/8] Checking narration read quality (raw ASR vs script)...")
        voice_qa_file = video_out_dir / f"voice_qa_v{video_id}.json"
        if audio_file.exists():
            script_tmp = video_out_dir / f"voice_qa_script_v{video_id}.txt"
            script_tmp.write_text(script_jp, encoding="utf-8")
            res = subprocess.run(
                [str(GPT_SOVITS_PY), str(SCRIPTS_DIR / "voice_qa.py"), "--audio", str(audio_file),
                 "--script_file", str(script_tmp), "--output", str(voice_qa_file)],
                cwd=str(REPO_ROOT), text=True, encoding="utf-8", errors="replace", capture_output=True,
            )
            script_tmp.unlink(missing_ok=True)
            # Non-fatal: the gate reports a missing QA file as a warning.
            print(res.stdout.strip() or f"  ⚠ voice QA failed: {res.stderr.strip()[-500:]}")

    # -------------------------------------------------------------------------
    # STAGE 7: Consolidate Output Assets & Save Artifacts
    # -------------------------------------------------------------------------
    print("\n[STAGE 7/8] Consolidating 6 Output Files in output directory...")

    # Copy thumbnail
    if thumbnail_image_url:
        src_thumb = BASE_DIR / "public" / "thumbnails" / Path(thumbnail_image_url).name
        if src_thumb.exists():
            shutil.copy2(src_thumb, thumb_file)
            print(f"  ✅ Saved Thumbnail: {thumb_file.name}")

    # Extract audio duration
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT audio_duration FROM ko_jp_videos WHERE id = %s", (video_id,))
            row = cur.fetchone()
            if row:
                audio_duration_actual = row[0]
    finally:
        conn.close()

    # Save data.json
    full_data = {
        "id": video_id,
        "source_url": source_url,
        "source_video_id": source_video_id,
        "source_title": source_title,
        "title_jp": title_primary,
        "title_a_jp": title_a_jp,
        "title_b_jp": title_b_jp,
        "title_c_jp": title_c_jp,
        "title_validation": ai_result.get("title_validation"),
        "description_jp": description_jp,
        "chapters_raw": extract_raw_chapter_lines(description_jp),
        "chapter_sync": chapter_sync,
        "youtube_tags": youtube_tags,
        "tags_tiered": tags_tiered,
        "pinned_comment": pinned_comment,
        "thumbnail_text": thumbnail_text,
        "thumbnail_options": thumbnail_options,
        "thumbnail_image_url": thumbnail_image_url,
        "conversation_url": conversation_url,
        "audio_url": f"/api/audio?file={audio_file.name}" if audio_file.exists() else None,
        "audio_duration_seconds": audio_duration_actual,
        "final_script_jp": script_jp,
        "char_count": len(script_jp),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    data_json_file.write_text(json.dumps(full_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  ✅ Saved Data JSON: {data_json_file.name}")

    # Save summary.txt
    summary_content = (
        f"Title (JP):\n"
        f"★ Hypothesis A (Warning/Conflict):\n{title_a_jp}\n"
        f"★ Hypothesis B (Paradox/Reverse):\n{title_b_jp}\n"
        f"★ Hypothesis C (Age-Specific 60s):\n{title_c_jp}\n\n"
        f"Thumbnail Text:\n{thumbnail_text}\n\n"
        f"Description:\n{description_jp}\n\n"
        f"YouTube Tags (All tiers merged):\n{youtube_tags}\n\n"
        f"Pinned Comment:\n{pinned_comment}\n\n"
        f"Script (JP):\n{script_jp}"
    )
    summary_txt_file.write_text(summary_content, encoding="utf-8")
    print(f"  ✅ Saved Summary TXT: {summary_txt_file.name}")

    # -------------------------------------------------------------------------
    # STAGE 8: Build YouTube Upload Kit & Run Compliance Audit
    # -------------------------------------------------------------------------
    print("\n[STAGE 8/8] Building YouTube Upload Kit with Compliance Audit...")
    kit_script = SCRIPTS_DIR / "build_metadata_kit.py"
    run_command_live(
        ["uv", "run", "python", str(kit_script), "--video_id", str(video_id)],
        REPO_ROOT,
        "STAGE 8 Upload Kit"
    )

    elapsed = time.time() - start_time
    print("\n" + "=" * 80)
    print(f"🎉 PIPELINE COMPLETED SUCCESSFULLY IN {elapsed:.1f} SECONDS!")
    print(f"Output Directory: {video_out_dir}")
    print(f"Upload Kit: {kit_txt_file}")
    print("=" * 80)

    return {
        "ok": True,
        "video_id": video_id,
        "folder_path": str(video_out_dir),
        "upload_kit_path": str(kit_txt_file),
        "title_a": title_a_jp,
        "title_b": title_b_jp,
        "title_c": title_c_jp,
        "elapsed_seconds": round(elapsed, 1),
    }


def main():
    parser = argparse.ArgumentParser(description="Master 1-Command Auto YouTube JP Drama Pipeline")
    parser.add_argument("url", help="YouTube video URL to process")
    parser.add_argument("--skip-tts", action="store_true", help="Skip TTS and SRT generation (fast metadata mode)")
    parser.add_argument("--no-image", action="store_true", help="Skip thumbnail image generation")
    args = parser.parse_args()

    result = asyncio.run(run_master_pipeline(
        youtube_url=args.url,
        skip_tts=args.skip_tts,
        generate_image=not args.no_image,
    ))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
