"""
youtube_upload.py
=================
CLI orchestrator for YouTube uploads in web_ko_jp.
Manages the entire upload lifecycle:
  1. upload   : Preflight -> DB entry -> Bridge invocation -> Draft Private creation.
  2. status   : Shows stage, YouTube Video ID, error, scheduled time, and Studio edit link.
  3. approve  : Approves a draft_private video and schedules to next slot or publishes now.
  4. resume   : Resumes an interrupted upload using existing_video_id checkpoint.
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys
import time
from typing import Any, Callable, Dict, Optional

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = Path(__file__).resolve().parent
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from channel_profile import (
    PUBLISH_DAILY_LIMIT,
    PUBLISH_LEAD_MINUTES,
    PUBLISH_SLOTS,
    PUBLISH_TIMEZONE,
    YOUTUBE_CHANNEL_ID,
)
from channel_registry import ChannelRegistry
from publication_scheduler import find_next_publication_slot
import upload_preflight
import upload_store

BRIDGE_SCRIPT = SCRIPTS_DIR / "youtube_upload_bridge.py"


def stream_bridge_process(
    nexus_python: Path,
    bridge_script: Path,
    job_file: Path,
    log_file: Path,
    on_event: Callable[[Dict[str, Any]], None],
) -> int:
    """
    Launches the bridge in nexus_python and tails its JSONL event log file in real time.
    """
    log_file.unlink(missing_ok=True)

    cmd = [
        str(nexus_python),
        str(bridge_script),
        "--job-file",
        str(job_file),
        "--log-file",
        str(log_file),
    ]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    read_pos = 0
    while True:
        if log_file.exists():
            with open(log_file, "r", encoding="utf-8") as f:
                f.seek(read_pos)
                while line := f.readline():
                    read_pos = f.tell()
                    line_str = line.strip()
                    if line_str:
                        try:
                            event = json.loads(line_str)
                            on_event(event)
                        except Exception as err:
                            print(f"[WARN] Failed to parse bridge log event: {err} -> {line_str}")

        ret = proc.poll()
        if ret is not None:
            # Drain remaining lines from log file
            if log_file.exists():
                with open(log_file, "r", encoding="utf-8") as f:
                    f.seek(read_pos)
                    while line := f.readline():
                        line_str = line.strip()
                        if line_str:
                            try:
                                on_event(json.loads(line_str))
                            except Exception:
                                pass
            break
        time.sleep(0.25)

    stdout, stderr = proc.communicate()
    if ret != 0 and stderr.strip():
        print(f"[BRIDGE STDERR] {stderr.strip()[-500:]}")
    return ret


def cmd_upload(
    video_id: int,
    ack_warn: bool = False,
    force_new: bool = False,
    skip_gpm_check: bool = False,
    config_path: Optional[Path] = None,
) -> int:
    """Uploads video as a PRIVATE draft after verifying preflight checks."""
    print(f"\n[1/4] Running preflight checks for video v{video_id}...")
    preflight = upload_preflight.run_preflight(
        video_id=video_id,
        ack_warn=ack_warn,
        force_new=force_new,
        config_path=config_path,
        skip_gpm_check=skip_gpm_check,
    )
    print(upload_preflight.render_preflight_summary(preflight))

    if not preflight.ok:
        print("\n❌ Upload aborted: preflight checks failed.")
        return 1

    print("\n[2/4] Registering upload in database (stage=preflight_ok)...")
    upload_rec = upload_store.create_or_resume(
        video_id=video_id,
        snapshot=preflight.metadata_snapshot,
        gate_status=preflight.gate_report.status if preflight.gate_report else "PASS",
        artifact_sha256=preflight.sha256 or "",
        warn_acknowledged=ack_warn,
        force_new=force_new,
    )
    upload_id = upload_rec["id"]
    existing_vid = upload_rec.get("youtube_video_id")
    print(f"  Upload record ID: {upload_id} (stage={upload_rec['stage']})")
    if existing_vid:
        print(f"  Resuming existing video ID: {existing_vid}")

    folder = preflight.folder or (REPO_ROOT / "web_ko_jp" / "output")
    job_file = folder / f"upload_job_v{video_id}.json"
    log_file = folder / f"upload_log_v{video_id}.jsonl"

    job_data = {
        "action": "upload",
        "profile_id": preflight.config["gpm_profile_id"],
        "video_path": str(preflight.mp4_path),
        "thumbnail_path": str(preflight.thumbnail_path) if preflight.thumbnail_path else None,
        "caption_path": str(preflight.srt_path) if preflight.srt_path else None,
        "title": preflight.metadata_snapshot.get("title", ""),
        "description": preflight.metadata_snapshot.get("description", ""),
        "tags": preflight.metadata_snapshot.get("tags") or [],
        "category_id": preflight.metadata_snapshot.get("category_id", "27"),
        "made_for_kids": preflight.metadata_snapshot.get("made_for_kids", False),
        "contains_synthetic_media": preflight.metadata_snapshot.get("contains_synthetic_media", True),
        "publish_mode": "private",  # Mandatory: upload as PRIVATE draft first
        "language": "ja",
        "publication_timezone": PUBLISH_TIMEZONE,
        "expected_channel_id": preflight.metadata_snapshot.get("expected_channel_id", YOUTUBE_CHANNEL_ID),
        "existing_video_id": existing_vid,
        "nexus_root": preflight.config["nexus_root"],
    }
    job_file.write_text(json.dumps(job_data, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n[3/4] Updating stage to 'uploading' and invoking bridge via Nexus...")
    upload_store.update_stage(upload_id, "uploading")

    captured_video_id = existing_vid
    final_stage = "draft_private"

    def handle_event(event: Dict[str, Any]) -> None:
        nonlocal captured_video_id, final_stage
        etype = event.get("type")
        if etype == "video_id":
            vid = event.get("video_id")
            if vid and vid != captured_video_id:
                captured_video_id = vid
                upload_store.record_youtube_video_id(upload_id, vid)
                print(f"  🎯 [YOUTUBE VIDEO ID] Assigned: {vid} (saved to DB immediately)")

        elif etype == "progress":
            step = event.get("step", "")
            msg = event.get("message", "")
            pct = event.get("percent", 0)
            print(f"  ⏳ [{pct:>3}%] {step}: {msg}")

        elif etype == "checkpoint":
            stage = event.get("stage", "")
            print(f"  📍 [CHECKPOINT] {stage}")

        elif etype == "result":
            status = event.get("status")
            vid = event.get("video_id") or captured_video_id
            if vid:
                upload_store.record_youtube_video_id(upload_id, vid)
            if status == "needs_review":
                final_stage = "needs_review"
                err_msg = event.get("error", "Upload requires manual review in YouTube Studio")
                upload_store.set_error(upload_id, err_msg, stage="needs_review")
                print(f"\n  ⚠ [NEEDS REVIEW] {err_msg}")
            else:
                final_stage = "draft_private"
                upload_store.update_stage(upload_id, "draft_private")
                print(f"\n  ✅ [SUCCESS] Video draft uploaded as PRIVATE!")
                print(f"     YouTube Video ID: {vid}")
                print(f"     Studio Edit Link: https://studio.youtube.com/video/{vid}/edit")

        elif etype == "error":
            err_msg = event.get("error", "Unknown upload bridge error")
            upload_store.set_error(upload_id, err_msg, stage="failed")
            print(f"\n  ❌ [BRIDGE ERROR] {err_msg}")

    nexus_py = Path(preflight.config["nexus_python"])
    exit_code = stream_bridge_process(nexus_py, BRIDGE_SCRIPT, job_file, log_file, handle_event)

    print("\n[4/4] Upload process finished.")
    latest = upload_store.get_upload_by_id(upload_id)
    if latest and latest.get("stage") == "draft_private":
        vid = latest.get("youtube_video_id")
        print("\n" + "=" * 80)
        print(f"  🎉 SUCCESS: Video v{video_id} is ready for review in YouTube Studio!")
        print(f"  🔗 Studio URL: https://studio.youtube.com/video/{vid}/edit")
        print("  📋 Review checklist:")
        print("     1. Check title, description chapters, tags, and subtitles.")
        print("     2. Listen to flagged audio timestamps in the Upload Kit.")
        print(f"  👉 When ready, approve and schedule via:")
        print(f"     uv run python web_ko_jp/scripts/youtube_upload.py approve --video_id {video_id} --next-slot")
        print("=" * 80)
        return 0
    elif latest and latest.get("stage") == "needs_review":
        print(f"\n⚠ Video v{video_id} is in 'needs_review' stage. Inspect Studio and resolve manually.")
        return 2
    else:
        err = latest.get("error") if latest else "Bridge returned error"
        print(f"\n❌ Upload failed for video v{video_id}: {err}")
        return 1


def cmd_status(video_id: int) -> int:
    """Displays current upload status for a video."""
    upload_rec = upload_store.get_active_upload(video_id) or upload_store.get_latest_upload_for_video(video_id)
    if not upload_rec:
        print(f"No upload records found for video v{video_id}.")
        return 1

    vid = upload_rec.get("youtube_video_id")
    studio_url = f"https://studio.youtube.com/video/{vid}/edit" if vid else "N/A"

    print("\n" + "=" * 60)
    print(f"  UPLOAD STATUS — Video v{video_id}")
    print("=" * 60)
    print(f"  Stage          : {upload_rec.get('stage')}")
    print(f"  YouTube Video ID: {vid or 'N/A'}")
    print(f"  Studio Link    : {studio_url}")
    print(f"  Gate Status    : {upload_rec.get('gate_status') or 'N/A'}")
    print(f"  Scheduled At   : {upload_rec.get('scheduled_at') or 'N/A'}")
    if upload_rec.get("warn_acknowledged_at"):
        print(f"  Warn Ack At    : {upload_rec.get('warn_acknowledged_at')}")
    if upload_rec.get("error"):
        print(f"  Last Error     : {upload_rec.get('error')}")
    print(f"  Updated At     : {upload_rec.get('updated_at')}")
    print("=" * 60)
    return 0


def cmd_approve(
    video_id: int,
    next_slot: bool = False,
    at_iso: Optional[str] = None,
    public_now: bool = False,
    config_path: Optional[Path] = None,
) -> int:
    """Approves a draft_private video and schedules to next slot or publishes immediately."""
    upload_rec = upload_store.get_active_upload(video_id)
    if not upload_rec:
        print(f"❌ No active upload record found for video v{video_id}.")
        return 1

    curr_stage = upload_rec.get("stage")
    if curr_stage != "draft_private":
        print(
            f"❌ Cannot approve video v{video_id}: current stage is '{curr_stage}'. "
            "Video must be in 'draft_private' stage."
        )
        return 1

    youtube_vid = upload_rec.get("youtube_video_id")
    if not youtube_vid:
        print(f"❌ Upload record for video v{video_id} is missing youtube_video_id.")
        return 1

    cfg, cfg_errors = upload_preflight.load_upload_config(config_path)
    if cfg_errors or not cfg:
        for err in cfg_errors:
            print(f"❌ Config error: {err}")
        return 1

    folder = upload_preflight.find_output_folder(video_id) or (REPO_ROOT / "web_ko_jp" / "output")
    job_file = folder / f"approve_job_v{video_id}.json"
    log_file = folder / f"approve_log_v{video_id}.jsonl"

    if public_now:
        action = "publish_now"
        schedule_target = None
        print(f"\n🚀 Approving video v{video_id} for IMMEDIATE PUBLIC release...")
        job_data = {
            "action": action,
            "profile_id": cfg["gpm_profile_id"],
            "existing_video_id": youtube_vid,
            "nexus_root": cfg["nexus_root"],
        }
    else:
        action = "schedule"
        if at_iso:
            try:
                dt_at = datetime.fromisoformat(at_iso)
                schedule_target = dt_at.isoformat()
            except Exception as err:
                print(f"❌ Invalid --at datetime format: {err}")
                return 1
        elif next_slot:
            occupied = upload_store.list_scheduled_slots()
            try:
                schedule_target = find_next_publication_slot(
                    timezone_name=PUBLISH_TIMEZONE,
                    slots=PUBLISH_SLOTS,
                    daily_limit=PUBLISH_DAILY_LIMIT,
                    lead_minutes=PUBLISH_LEAD_MINUTES,
                    occupied_utc=occupied,
                )
            except Exception as err:
                print(f"❌ Failed to find next publication slot: {err}")
                return 1
        else:
            print("❌ Must specify one of: --next-slot, --at ISO, or --public-now.")
            return 1

        print(f"\n📅 Approving video v{video_id} for SCHEDULING at: {schedule_target} (UTC)...")
        snapshot = upload_rec.get("snapshot") or {}
        job_data = {
            "action": action,
            "profile_id": cfg["gpm_profile_id"],
            "existing_video_id": youtube_vid,
            "publish_mode": "schedule",
            "schedule_at": schedule_target,
            "publication_timezone": PUBLISH_TIMEZONE,
            "expected_channel_id": YOUTUBE_CHANNEL_ID,
            "title": snapshot.get("title", ""),
            "description": snapshot.get("description", ""),
            "tags": snapshot.get("tags") or [],
            "category_id": snapshot.get("category_id", "27"),
            "language": "ja",
            "nexus_root": cfg["nexus_root"],
        }

    job_file.write_text(json.dumps(job_data, ensure_ascii=False, indent=2), encoding="utf-8")

    def handle_event(event: Dict[str, Any]) -> None:
        etype = event.get("type")
        if etype == "progress":
            print(f"  ⏳ [{event.get('percent', 0)}%] {event.get('step')}: {event.get('message')}")
        elif etype == "checkpoint":
            print(f"  📍 [CHECKPOINT] {event.get('stage')}")
        elif etype == "result":
            print(f"  ✅ [BRIDGE SUCCESS] {event.get('status')}")
        elif etype == "error":
            print(f"  ❌ [BRIDGE ERROR] {event.get('error')}")

    nexus_py = Path(cfg["nexus_python"])
    exit_code = stream_bridge_process(nexus_py, BRIDGE_SCRIPT, job_file, log_file, handle_event)

    if exit_code == 0:
        if public_now:
            upload_store.update_stage(upload_rec["id"], "published")
            print(f"\n🎉 Video v{video_id} has been PUBLISHED successfully!")
        else:
            sched_dt = datetime.fromisoformat(schedule_target) if schedule_target else None
            upload_store.update_stage(upload_rec["id"], "scheduled", scheduled_at=sched_dt)
            print(f"\n🎉 Video v{video_id} has been SCHEDULED successfully for {schedule_target}!")

        # Update ChannelRegistry
        try:
            reg = ChannelRegistry.load()
            snapshot = upload_rec.get("snapshot") or {}
            reg.record_kit(
                title=snapshot.get("title", ""),
                chapters=snapshot.get("chapter_lines") or [],
                db_video_id=video_id,
                source_video_id=snapshot.get("source_video_id", ""),
                video_id=youtube_vid,
            )
            reg.save()
            print("  📖 ChannelRegistry updated with real YouTube Video ID.")
        except Exception as err:
            print(f"  ⚠ Failed to update ChannelRegistry: {err}")

        return 0
    else:
        print(f"\n❌ Approval / scheduling failed with exit code {exit_code}")
        return exit_code


def cmd_resume(
    video_id: int,
    ack_warn: bool = False,
    skip_gpm_check: bool = False,
    config_path: Optional[Path] = None,
) -> int:
    """Resumes an interrupted upload using existing_video_id checkpoint."""
    upload_rec = upload_store.get_active_upload(video_id)
    if not upload_rec:
        print(f"No active upload found for video v{video_id}. Starting fresh upload...")
        return cmd_upload(
            video_id=video_id,
            ack_warn=ack_warn,
            force_new=False,
            skip_gpm_check=skip_gpm_check,
            config_path=config_path,
        )

    stage = upload_rec.get("stage")
    print(f"Found active upload for video v{video_id} in stage '{stage}'.")
    if stage in ("scheduled", "published"):
        print(f"Video v{video_id} is already in '{stage}' stage. Nothing to resume.")
        return 0
    if stage == "draft_private":
        print(
            f"Video v{video_id} is already a PRIVATE draft in YouTube Studio. "
            f"Run 'approve' command to schedule or publish."
        )
        return 0

    print("Resuming upload workflow...")
    return cmd_upload(
        video_id=video_id,
        ack_warn=ack_warn,
        force_new=False,
        skip_gpm_check=skip_gpm_check,
        config_path=config_path,
    )


def main():
    parser = argparse.ArgumentParser(description="YouTube Upload Orchestrator for web_ko_jp")
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    # Subcommand: upload
    p_upload = subparsers.add_parser("upload", help="Preflight check and upload video as PRIVATE draft")
    p_upload.add_argument("--video_id", type=int, required=True, help="DB Video ID")
    p_upload.add_argument("--ack-warn", action="store_true", help="Acknowledge gate and spec warnings")
    p_upload.add_argument("--force-new", action="store_true", help="Force new upload even if previously scheduled")
    p_upload.add_argument("--skip-gpm-check", action="store_true", help="Skip live GPM API check")
    p_upload.add_argument("--config", type=Path, default=None, help="Path to upload_config.json")

    # Subcommand: status
    p_status = subparsers.add_parser("status", help="Show upload status and Studio link")
    p_status.add_argument("--video_id", type=int, required=True, help="DB Video ID")

    # Subcommand: approve
    p_approve = subparsers.add_parser("approve", help="Approve draft_private video and schedule or publish")
    p_approve.add_argument("--video_id", type=int, required=True, help="DB Video ID")
    p_approve.add_argument("--next-slot", action="store_true", help="Schedule at next available slot (20:00 JST)")
    p_approve.add_argument("--at", dest="at_iso", type=str, default=None, help="Schedule at specific ISO datetime")
    p_approve.add_argument("--public-now", action="store_true", help="Publish immediately as public")
    p_approve.add_argument("--config", type=Path, default=None, help="Path to upload_config.json")

    # Subcommand: resume
    p_resume = subparsers.add_parser("resume", help="Resume interrupted upload from checkpoint")
    p_resume.add_argument("--video_id", type=int, required=True, help="DB Video ID")
    p_resume.add_argument("--ack-warn", action="store_true", help="Acknowledge gate and spec warnings")
    p_resume.add_argument("--skip-gpm-check", action="store_true", help="Skip live GPM API check")
    p_resume.add_argument("--config", type=Path, default=None, help="Path to upload_config.json")

    args = parser.parse_args()

    if args.subcommand == "upload":
        ret = cmd_upload(
            video_id=args.video_id,
            ack_warn=args.ack_warn,
            force_new=args.force_new,
            skip_gpm_check=args.skip_gpm_check,
            config_path=args.config,
        )
    elif args.subcommand == "status":
        ret = cmd_status(video_id=args.video_id)
    elif args.subcommand == "approve":
        ret = cmd_approve(
            video_id=args.video_id,
            next_slot=args.next_slot,
            at_iso=args.at_iso,
            public_now=args.public_now,
            config_path=args.config,
        )
    elif args.subcommand == "resume":
        ret = cmd_resume(
            video_id=args.video_id,
            ack_warn=args.ack_warn,
            skip_gpm_check=args.skip_gpm_check,
            config_path=args.config,
        )
    else:
        parser.print_help()
        ret = 1

    sys.exit(ret)


if __name__ == "__main__":
    main()
