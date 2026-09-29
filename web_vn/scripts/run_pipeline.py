# -*- coding: utf-8 -*-
"""
End-to-End Orchestrator Pipeline for Vietnamese Audio Drama (Sâm Kể Chuyện) v4.1

Executes the full automated workflow from topic generation to master audio MP3:
  [Step 1] Topic & Master Blueprint Generation (Topic Matrix + Dedup Engine)
  [Step 2] ChatGPT 6-Turn Story Scriptwriting (Playwright with Profile Retention)
  [Step 3] Script to Audio Manifest Parsing (Dynamic Silence & Speaker Tagging)
  [Step 4] Quality Gate & Manifest Validation (Word Limits, Pacing, Role Integrity)
  [Step 5] Multi-Role TTS Audio Synthesis (VieNeu-TTS v3 Turbo 48kHz)
  [Step 6] Master Concatenation & BGM Sidechain Ducking (-16 LUFS EBU R128)

Usage:
  python web_vn/scripts/run_pipeline.py --story-id story_bo_chong_02 --cluster cluster_bo_chong_con_dau
  python web_vn/scripts/run_pipeline.py --story-id story_bo_chong_01 --skip-chatgpt --chapter 1
"""

import sys
import os
import time
import json
import argparse
import subprocess
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Dict, Any

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "web_vn" / "scripts"
DATA_DIR = REPO_ROOT / "web_vn" / "data"
OUTPUT_DIR = REPO_ROOT / "web_vn" / "output"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("pipeline_orchestrator")


def update_state(story_dir: Path, step_name: str, status: str, details: Optional[Dict[str, Any]] = None):
    """Persists pipeline execution checkpoint to pipeline_state.json."""
    state_file = story_dir / "pipeline_state.json"
    state = {}
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    state[step_name] = {
        "status": status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "details": details or {}
    }
    state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def run_step_1_seed(story_id: str, cluster_id: Optional[str], story_dir: Path, auto_register: bool = True) -> dict:
    """Step 1: Generate or load topic seed."""
    logger.info("=" * 70)
    logger.info("👉 STEP 1/6: Topic Seed & Blueprint Generation")
    logger.info("=" * 70)

    seed_file = story_dir / "topic_seed.json"
    if seed_file.exists() and seed_file.stat().st_size > 100:
        logger.info(f"Reusing existing topic_seed.json at: {seed_file}")
        seed = json.loads(seed_file.read_text(encoding="utf-8"))
    else:
        from story_generator import generate_topic_seed, generate_master_blueprint, generate_chapters_outline
        seed = generate_topic_seed(
            story_id=story_id,
            cluster_id=cluster_id,
            auto_register=auto_register,
            output_dir=story_dir
        )
        bp = generate_master_blueprint(seed)
        chaps = generate_chapters_outline(bp)
        (story_dir / "master_blueprint.json").write_text(json.dumps(bp, ensure_ascii=False, indent=2), encoding="utf-8")
        (story_dir / "chapters_outline.json").write_text(json.dumps(chaps, ensure_ascii=False, indent=2), encoding="utf-8")

    logger.info(f"Topic Title: {seed.get('title')}")
    logger.info(f"Victim Role: [{seed.get('victim_role')}] {seed.get('characters', {}).get(seed.get('victim_role'), '')}")
    logger.info(f"Characters : {seed.get('characters')}")

    update_state(story_dir, "step_1_seed", "DONE", {
        "title": seed.get("title"),
        "cluster_id": seed.get("cluster_id"),
        "victim_role": seed.get("victim_role")
    })
    return seed


def run_step_2_script(story_id: str, story_dir: Path, ai_engine: str = "9router", headless: bool = False):
    """Step 2: Script generation via 9Router Gemini API (default) or ChatGPT Playwright."""
    logger.info("=" * 70)
    logger.info(f"👉 STEP 2/6: Scriptwriting Generation [{ai_engine.upper()}]")
    logger.info("=" * 70)

    # Check if final or turn files already exist
    full_script_file = story_dir / "full_story_script.md"
    if full_script_file.exists() and full_script_file.stat().st_size > 1000:
        logger.info(f"Full story script already exists ({full_script_file.stat().st_size:,} bytes). Skipping script generation.")
        update_state(story_dir, "step_2_script", "SKIPPED_EXISTING", {"path": str(full_script_file)})
        return

    if ai_engine == "9router":
        logger.info("Launching 9Router Gemini API high-speed story pipeline...")
        cmd = [
            sys.executable,
            str(SCRIPTS_DIR / "gemini_vn_story_pipeline.py"),
            "--story-id", story_id
        ]
    else:
        logger.info("Launching Playwright ChatGPT multi-turn automation...")
        cmd = [
            sys.executable,
            str(SCRIPTS_DIR / "chatgpt_vn_story_pipeline.py"),
            "--story-id", story_id
        ]
        if headless:
            cmd.append("--headless")

    subprocess.run(cmd, check=True)

    update_state(story_dir, "step_2_script", "DONE", {
        "engine": ai_engine,
        "full_script_exists": full_script_file.exists()
    })



def run_step_3_parser(story_id: str, story_dir: Path) -> Path:
    """Step 3: Parse markdown script to audio manifest."""
    logger.info("=" * 70)
    logger.info("👉 STEP 3/6: Script Audio Parser (Manifest Generation)")
    logger.info("=" * 70)

    cmd = [
        sys.executable,
        str(SCRIPTS_DIR / "script_audio_parser.py"),
        "--story-id", story_id
    ]
    subprocess.run(cmd, check=True)

    manifest_file = story_dir / "audio_manifest.jsonl"
    if not manifest_file.exists() or manifest_file.stat().st_size == 0:
        raise FileNotFoundError(f"Manifest file was not generated: {manifest_file}")

    lines = [l for l in manifest_file.read_text(encoding="utf-8").splitlines() if l.strip()]
    logger.info(f"Parsed {len(lines)} audio chunks into manifest.")

    update_state(story_dir, "step_3_manifest", "DONE", {"total_chunks": len(lines)})
    return manifest_file


def run_step_4_validate(manifest_file: Path, story_dir: Path):
    """Step 4: Quality Gate validation."""
    logger.info("=" * 70)
    logger.info("👉 STEP 4/6: Audio Manifest Quality Gate Validation")
    logger.info("=" * 70)

    from validate_manifest import validate_manifest
    is_valid = validate_manifest(manifest_file)

    if not is_valid:
        update_state(story_dir, "step_4_validate", "FAILED", {"manifest": str(manifest_file)})
        raise ValueError(f"Quality Gate FAILED for manifest: {manifest_file}. Please check errors above.")

    logger.info("✅ Quality Gate PASSED: Manifest conforms to 100% production standards.")
    update_state(story_dir, "step_4_validate", "PASS", {"manifest": str(manifest_file)})


def run_step_5_tts(
    story_id: str,
    story_dir: Path,
    engine: str = "vieneu",
    chapter: Optional[int] = None,
    limit: Optional[int] = None,
    bgm_path: Optional[str] = None
):
    """Step 5: Multi-role TTS audio synthesis & master mix."""
    logger.info("=" * 70)
    logger.info(f"👉 STEP 5 & 6: TTS Audio Synthesis [{engine.upper()}] & Master Mastering")
    logger.info("=" * 70)

    cmd = [
        sys.executable,
        str(SCRIPTS_DIR / "story_audio_generator.py"),
        "--story-id", story_id,
        "--engine", engine
    ]
    if chapter is not None:
        cmd.extend(["--chapter", str(chapter)])
    if limit is not None:
        cmd.extend(["--limit", str(limit)])
    if bgm_path:
        cmd.extend(["--bgm", bgm_path])

    subprocess.run(cmd, check=True)

    master_mp3 = story_dir / "full_story_audio.mp3"
    clean_wav = story_dir / "narration_clean.wav"

    update_state(story_dir, "step_5_tts", "DONE", {
        "engine": engine,
        "master_mp3": str(master_mp3) if master_mp3.exists() else None,
        "clean_wav": str(clean_wav) if clean_wav.exists() else None
    })


def run_step_7_video(story_id: str, story_dir: Path, title: str, cover_image: Optional[str] = None):
    """Step 7: Render 1080p MP4 Video with NVENC GPU."""
    logger.info("=" * 70)
    logger.info("👉 STEP 7/7: 1080p Video Rendering (NVENC GPU)")
    logger.info("=" * 70)

    from video_renderer import generate_story_cover_image, render_story_video

    cover_path = Path(cover_image) if cover_image else story_dir / "cover.png"
    if not cover_path.exists():
        logger.info(f"Generating cinematic cover image at: {cover_path}")
        generate_story_cover_image(
            title=title,
            output_image_path=cover_path,
            subtitle="Truyện Ngắn Đa Vai • VieNeu-TTS 48kHz Broadcast Master"
        )

    master_audio = story_dir / "full_story_audio.mp3"
    if not master_audio.exists():
        master_audio = story_dir / "narration_clean.wav"
    if not master_audio.exists():
        raise FileNotFoundError(f"Master audio not found for video render in {story_dir}")

    output_video = story_dir / "full_story_video.mp4"
    success = render_story_video(
        image_path=cover_path,
        audio_path=master_audio,
        output_path=output_video,
        use_gpu=True
    )
    if not success:
        update_state(story_dir, "step_7_video", "FAILED", {"video": str(output_video)})
        raise RuntimeError("Video rendering failed.")

    update_state(story_dir, "step_7_video", "DONE", {
        "video": str(output_video),
        "size_bytes": output_video.stat().st_size
    })
    logger.info(f"🎬 Master 1080p Video Ready: {output_video} ({output_video.stat().st_size:,} bytes)")


def main():
    parser = argparse.ArgumentParser(description="Vietnamese Audio Drama Orchestrator Pipeline v4.1")
    parser.add_argument("--story-id", type=str, required=True, help="Story identifier (e.g. story_bo_chong_02)")
    parser.add_argument("--cluster", type=str, default=None, help="Cluster preset ID from topic_matrix_presets.json")
    parser.add_argument("--ai-engine", type=str, default="9router", choices=["9router", "chatgpt"], help="LLM engine for scriptwriting (default: 9router)")
    parser.add_argument("--engine", type=str, default="vieneu", choices=["vieneu", "edge_tts", "omnivoice"], help="TTS engine")
    parser.add_argument("--skip-script", "--skip-chatgpt", dest="skip_script", action="store_true", help="Skip Step 2 (Script generation) if script exists")
    parser.add_argument("--skip-tts", action="store_true", help="Stop after manifest generation and validation")
    parser.add_argument("--skip-video", action="store_true", help="Skip Step 7 (video rendering)")
    parser.add_argument("--cover-image", type=str, default=None, help="Custom cover image path for video")
    parser.add_argument("--headless", action="store_true", help="Run Playwright in headless mode (if using chatgpt engine)")
    parser.add_argument("--chapter", type=int, default=None, help="Filter to specific chapter number")
    parser.add_argument("--limit-chunks", type=int, default=None, help="Limit number of chunks to synthesize")
    parser.add_argument("--bgm", type=str, default=None, help="Path to background music audio file")
    parser.add_argument("--no-dedup-register", action="store_true", help="Do not register topic in topic_registry.json")

    args = parser.parse_args()

    # Normalize story directory
    story_folder = args.story_id if args.story_id.startswith("story_") else f"story_{args.story_id}"
    story_dir = OUTPUT_DIR / story_folder
    story_dir.mkdir(parents=True, exist_ok=True)

    start_time = time.time()
    logger.info("╔" + "═" * 68 + "╗")
    logger.info("║     VIETNAMESE AUDIO DRAMA PRODUCTION PIPELINE v4.1 (E2E)     ║")
    logger.info("╚" + "═" * 68 + "╝")
    logger.info(f"Target Story : {story_folder}")
    logger.info(f"Output Dir   : {story_dir}")
    logger.info(f"AI Engine    : {args.ai_engine}")
    logger.info(f"TTS Engine   : {args.engine}")
    if args.cluster:
        logger.info(f"Topic Cluster: {args.cluster}")

    try:
        # Step 1: Topic Seed
        seed = run_step_1_seed(
            story_id=story_folder,
            cluster_id=args.cluster,
            story_dir=story_dir,
            auto_register=not args.no_dedup_register
        )
        title = seed.get("title", story_folder)

        # Step 2: Script Generation (9Router Gemini API or ChatGPT Playwright)
        if not args.skip_script:
            run_step_2_script(story_folder, story_dir, ai_engine=args.ai_engine, headless=args.headless)
        else:
            logger.info("Skipping scriptwriting (--skip-script enabled).")

        # Step 3: Script Audio Parser
        manifest_file = run_step_3_parser(story_folder, story_dir)


        # Step 4: Quality Gate & Validation
        run_step_4_validate(manifest_file, story_dir)

        # Step 5 & 6: TTS & Master Audio
        if not args.skip_tts:
            run_step_5_tts(
                story_id=story_folder,
                story_dir=story_dir,
                engine=args.engine,
                chapter=args.chapter,
                limit=args.limit_chunks,
                bgm_path=args.bgm
            )

            # Step 7: Video Rendering
            if not args.skip_video and args.chapter is None and args.limit_chunks is None:
                run_step_7_video(
                    story_id=story_folder,
                    story_dir=story_dir,
                    title=title,
                    cover_image=args.cover_image
                )
            elif not args.skip_video:
                logger.info("Rendering video for partial/single chapter run...")
                run_step_7_video(
                    story_id=story_folder,
                    story_dir=story_dir,
                    title=f"{title} (Chương {args.chapter})" if args.chapter else title,
                    cover_image=args.cover_image
                )
            else:
                logger.info("Skipping video rendering (--skip-video enabled).")
        else:
            logger.info("Stopping pipeline before TTS (--skip-tts enabled).")

        elapsed = time.time() - start_time
        logger.info("╔" + "═" * 68 + "╗")
        logger.info(f"║ 🎉 PIPELINE EXECUTION COMPLETED IN {elapsed:.1f}s ({elapsed/60:.2f} mins) ║")
        logger.info("╚" + "═" * 68 + "╝")
        master_mp3 = story_dir / "full_story_audio.mp3"
        master_mp4 = story_dir / "full_story_video.mp4"
        if master_mp3.exists():
            logger.info(f"🎧 Final Master MP3: {master_mp3} ({master_mp3.stat().st_size:,} bytes)")
        if master_mp4.exists():
            logger.info(f"🎬 Final Master MP4: {master_mp4} ({master_mp4.stat().st_size:,} bytes)")

    except Exception as e:
        logger.error(f"❌ PIPELINE EXECUTION FAILED: {e}", exc_info=True)
        update_state(story_dir, "pipeline_error", "ERROR", {"error": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
