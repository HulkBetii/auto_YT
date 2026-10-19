"""
upload_store.py
===============
PostgreSQL persistence layer for YouTube uploads in web_ko_jp.
Manages workflow state, checkpoints, video IDs, and scheduling slots in ko_jp_youtube_uploads.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional
import psycopg2
from psycopg2.extras import RealDictCursor


VALID_STAGES = (
    "preflight_ok",
    "uploading",
    "draft_created",
    "draft_private",
    "approved",
    "scheduled",
    "published",
    "needs_review",
    "failed",
)


def get_db_connection():
    """Connect to auto_yt_ko_jp Postgres via Docker port 5437."""
    return psycopg2.connect(
        host="localhost",
        port=5437,
        database="auto_yt_ko_jp",
        user="postgres",
        password="postgres",
    )


def _row_to_dict(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    d = dict(row)
    if isinstance(d.get("snapshot"), str):
        try:
            d["snapshot"] = json.loads(d["snapshot"])
        except Exception:
            pass
    return d


def get_active_upload(video_id: int) -> Optional[Dict[str, Any]]:
    """Return the active (non-failed) upload record for a video, if any."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT * FROM ko_jp_youtube_uploads
                WHERE video_id = %s AND stage != 'failed'
                ORDER BY id DESC LIMIT 1
                """,
                (video_id,),
            )
            return _row_to_dict(cur.fetchone())
    finally:
        conn.close()


def get_upload_by_id(upload_id: int) -> Optional[Dict[str, Any]]:
    """Fetch an upload record by its primary key ID."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM ko_jp_youtube_uploads WHERE id = %s",
                (upload_id,),
            )
            return _row_to_dict(cur.fetchone())
    finally:
        conn.close()


def get_latest_upload_for_video(video_id: int) -> Optional[Dict[str, Any]]:
    """Fetch the latest upload record for a video regardless of stage."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT * FROM ko_jp_youtube_uploads
                WHERE video_id = %s
                ORDER BY created_at DESC LIMIT 1
                """,
                (video_id,),
            )
            return _row_to_dict(cur.fetchone())
    finally:
        conn.close()


def create_or_resume(
    video_id: int,
    snapshot: Dict[str, Any],
    gate_status: str,
    artifact_sha256: str,
    warn_acknowledged: bool = False,
    force_new: bool = False,
) -> Dict[str, Any]:
    """
    Creates a new upload record or resumes an existing active upload.
    If force_new is True, any existing active record is marked 'failed' (superseded).
    """
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if force_new:
                cur.execute(
                    """
                    UPDATE ko_jp_youtube_uploads
                    SET stage = 'failed', error = 'Superseded by --force-new upload', updated_at = NOW()
                    WHERE video_id = %s AND stage != 'failed'
                    """,
                    (video_id,),
                )
                conn.commit()

            # Check if active record exists
            cur.execute(
                """
                SELECT * FROM ko_jp_youtube_uploads
                WHERE video_id = %s AND stage != 'failed'
                ORDER BY id DESC LIMIT 1
                """,
                (video_id,),
            )
            active = cur.fetchone()

            if active:
                # If already scheduled or published, do not overwrite snapshot without force_new
                if active["stage"] in ("scheduled", "published"):
                    return _row_to_dict(active)

                # Resume existing active upload: update snapshot and gate status
                warn_clause = ", warn_acknowledged_at = NOW()" if warn_acknowledged else ""
                cur.execute(
                    f"""
                    UPDATE ko_jp_youtube_uploads
                    SET snapshot = %s,
                        gate_status = %s,
                        artifact_sha256 = %s,
                        updated_at = NOW()
                        {warn_clause}
                    WHERE id = %s
                    RETURNING *
                    """,
                    (
                        json.dumps(snapshot, ensure_ascii=False),
                        gate_status,
                        artifact_sha256,
                        active["id"],
                    ),
                )
                conn.commit()
                return _row_to_dict(cur.fetchone())

            # Create new upload record
            cur.execute(
                """
                INSERT INTO ko_jp_youtube_uploads (
                    video_id, stage, snapshot, gate_status,
                    artifact_sha256, warn_acknowledged_at, updated_at
                ) VALUES (
                    %s, 'preflight_ok', %s, %s, %s,
                    CASE WHEN %s THEN NOW() ELSE NULL END, NOW()
                )
                RETURNING *
                """,
                (
                    video_id,
                    json.dumps(snapshot, ensure_ascii=False),
                    gate_status,
                    artifact_sha256,
                    warn_acknowledged,
                ),
            )
            conn.commit()
            return _row_to_dict(cur.fetchone())
    finally:
        conn.close()


def update_stage(
    upload_id: int,
    stage: str,
    error: Optional[str] = None,
    scheduled_at: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Transitions an upload record to a new stage."""
    if stage not in VALID_STAGES:
        raise ValueError(f"Invalid stage '{stage}'. Must be one of {VALID_STAGES}")

    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE ko_jp_youtube_uploads
                SET stage = %s,
                    error = COALESCE(%s, error),
                    scheduled_at = COALESCE(%s, scheduled_at),
                    updated_at = NOW()
                WHERE id = %s
                RETURNING *
                """,
                (stage, error, scheduled_at, upload_id),
            )
            conn.commit()
            record = cur.fetchone()
            if not record:
                raise RuntimeError(f"Upload record {upload_id} not found")
            return _row_to_dict(record)
    finally:
        conn.close()


def record_youtube_video_id(upload_id: int, youtube_video_id: str) -> Dict[str, Any]:
    """Records the YouTube Video ID as soon as assigned by YouTube Studio."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE ko_jp_youtube_uploads
                SET youtube_video_id = %s,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING *
                """,
                (youtube_video_id, upload_id),
            )
            conn.commit()
            record = cur.fetchone()
            if not record:
                raise RuntimeError(f"Upload record {upload_id} not found")
            return _row_to_dict(record)
    finally:
        conn.close()


def set_error(
    upload_id: int,
    error_message: str,
    stage: str = "failed",
) -> Dict[str, Any]:
    """Sets the error message and stage on an upload record."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE ko_jp_youtube_uploads
                SET error = %s,
                    stage = %s,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING *
                """,
                (error_message, stage, upload_id),
            )
            conn.commit()
            record = cur.fetchone()
            if not record:
                raise RuntimeError(f"Upload record {upload_id} not found")
            return _row_to_dict(record)
    finally:
        conn.close()


def list_scheduled_slots() -> List[datetime]:
    """
    Returns list of already occupied scheduled_at datetimes for active scheduled uploads.
    Used by publication_scheduler to avoid booking conflicting slots.
    """
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT scheduled_at FROM ko_jp_youtube_uploads
                WHERE stage = 'scheduled' AND scheduled_at IS NOT NULL
                ORDER BY scheduled_at ASC
                """
            )
            rows = cur.fetchall()
            return [r["scheduled_at"] for r in rows if r["scheduled_at"]]
    finally:
        conn.close()
