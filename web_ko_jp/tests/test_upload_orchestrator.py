"""
test_upload_orchestrator.py
===========================
Tests for upload orchestration logic, database state transitions, and bridge streaming.
"""

from __future__ import annotations

import json
from pathlib import Path
import pytest

import upload_store
from youtube_upload import (
    cmd_approve,
    cmd_status,
    stream_bridge_process,
)


@pytest.fixture
def clean_test_upload():
    """Provides a fresh video_id (e.g. 88888) and cleans up its upload records in the DB."""
    test_vid = 88888
    conn = upload_store.get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM ko_jp_youtube_uploads WHERE video_id = %s", (test_vid,))
            # Ensure fake video exists in ko_jp_videos to satisfy foreign key constraint
            cur.execute(
                """
                INSERT INTO ko_jp_videos (id, source_url, status)
                VALUES (%s, 'https://youtube.com/watch?v=test88888', 'ready')
                ON CONFLICT (id) DO NOTHING
                """,
                (test_vid,),
            )
            conn.commit()
    finally:
        conn.close()

    yield test_vid

    conn = upload_store.get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM ko_jp_youtube_uploads WHERE video_id = %s", (test_vid,))
            cur.execute("DELETE FROM ko_jp_videos WHERE id = %s", (test_vid,))
            conn.commit()
    finally:
        conn.close()


def test_upload_store_lifecycle(clean_test_upload):
    vid = clean_test_upload
    snapshot = {"title": "Test Title", "tags": ["tag1", "tag2"]}

    # 1. create_or_resume creates initial record at preflight_ok
    rec = upload_store.create_or_resume(
        video_id=vid,
        snapshot=snapshot,
        gate_status="PASS",
        artifact_sha256="abc123sha",
        warn_acknowledged=False,
    )
    assert rec["stage"] == "preflight_ok"
    assert rec["video_id"] == vid
    assert rec["gate_status"] == "PASS"

    upload_id = rec["id"]

    # 2. Record YouTube video ID early (as soon as bridge detects draft)
    updated = upload_store.record_youtube_video_id(upload_id, "dQw4w9WgXcQ")
    assert updated["youtube_video_id"] == "dQw4w9WgXcQ"

    # 3. Update stage to draft_private
    draft_rec = upload_store.update_stage(upload_id, "draft_private")
    assert draft_rec["stage"] == "draft_private"

    # 4. Check active upload
    active = upload_store.get_active_upload(vid)
    assert active is not None
    assert active["id"] == upload_id
    assert active["youtube_video_id"] == "dQw4w9WgXcQ"

    # 5. Set error marks stage as failed
    failed_rec = upload_store.set_error(upload_id, "Something broke", stage="failed")
    assert failed_rec["stage"] == "failed"
    assert failed_rec["error"] == "Something broke"

    # Now no active upload should exist because it's failed
    assert upload_store.get_active_upload(vid) is None


def test_stream_bridge_process_event_handling(tmp_path):
    """Verifies that stream_bridge_process parses events and invokes callbacks correctly."""
    # Create a dummy python script that writes mock JSONL events
    mock_bridge = tmp_path / "mock_bridge.py"
    mock_bridge.write_text(
        """
import argparse, json, time
parser = argparse.ArgumentParser()
parser.add_argument("--job-file")
parser.add_argument("--log-file")
args = parser.parse_args()

events = [
    {"type": "progress", "message": "Starting...", "step": "init", "percent": 10},
    {"type": "video_id", "video_id": "test_vid_xyz"},
    {"type": "checkpoint", "stage": "thumbnail_verified"},
    {"type": "result", "status": "draft_private", "video_id": "test_vid_xyz"},
]
with open(args.log_file, "w", encoding="utf-8") as f:
    for e in events:
        f.write(json.dumps(e) + "\\n")
        f.flush()
        time.sleep(0.05)
""",
        encoding="utf-8",
    )

    job_file = tmp_path / "job.json"
    job_file.write_text("{}", encoding="utf-8")
    log_file = tmp_path / "log.jsonl"

    received_events = []
    import sys

    exit_code = stream_bridge_process(
        nexus_python=Path(sys.executable),
        bridge_script=mock_bridge,
        job_file=job_file,
        log_file=log_file,
        on_event=lambda e: received_events.append(e),
    )

    assert exit_code == 0
    event_types = [e["type"] for e in received_events]
    assert "progress" in event_types
    assert "video_id" in event_types
    assert "checkpoint" in event_types
    assert "result" in event_types

    vid_event = next(e for e in received_events if e["type"] == "video_id")
    assert vid_event["video_id"] == "test_vid_xyz"


def test_cmd_status(clean_test_upload, capsys):
    vid = clean_test_upload
    # When no record exists
    ret = cmd_status(vid)
    out = capsys.readouterr().out
    assert "No upload records found" in out

    # Create record
    rec = upload_store.create_or_resume(
        video_id=vid,
        snapshot={"title": "Test Title"},
        gate_status="PASS",
        artifact_sha256="abc",
    )
    upload_store.record_youtube_video_id(rec["id"], "vid_12345")
    upload_store.update_stage(rec["id"], "draft_private")

    ret2 = cmd_status(vid)
    assert ret2 == 0
    out2 = capsys.readouterr().out
    assert "Stage          : draft_private" in out2
    assert "vid_12345" in out2
    assert "https://studio.youtube.com/video/vid_12345/edit" in out2


def test_cmd_approve_blocks_if_not_draft_private(clean_test_upload, capsys):
    vid = clean_test_upload
    rec = upload_store.create_or_resume(
        video_id=vid,
        snapshot={"title": "Test"},
        gate_status="PASS",
        artifact_sha256="abc",
    )
    # Stage is preflight_ok, NOT draft_private
    ret = cmd_approve(video_id=vid, next_slot=True)
    assert ret == 1
    out = capsys.readouterr().out
    assert "must be in 'draft_private' stage" in out
