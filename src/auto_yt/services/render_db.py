"""Database contract for the local web video render worker."""
from __future__ import annotations

import logging
from uuid import uuid4

from auto_yt.services.job_queue import _connect

logger = logging.getLogger(__name__)

MAX_RENDER_ATTEMPTS = 4
STALE_RENDER_MINUTES = 10


async def claim_render_video(dsn: str) -> dict | None:
    """Claim the next queued, retryable, or stale render with a unique lease."""
    return await _claim_render_video(dsn)


async def claim_specific_render(dsn: str, video_id: int) -> dict | None:
    """Force-claim one video for a manual render unless another worker owns it."""
    return await _claim_render_video(dsn, video_id=video_id, force=True)


async def _claim_render_video(
    dsn: str,
    *,
    video_id: int | None = None,
    force: bool = False,
) -> dict | None:
    token = uuid4().hex
    conn = await _connect(dsn)
    try:
        async with conn.transaction():
            await conn.execute(
                """
                UPDATE videos
                SET render_status = 'failed',
                    render_error = 'Render lease expired after terminal attempt',
                    render_next_attempt_at = NULL,
                    render_finished_at = now(),
                    render_worker_token = NULL
                WHERE render_status = 'rendering'
                  AND render_attempt_count >= $1
                  AND COALESCE(render_heartbeat_at, render_started_at, created_at)
                      < now() - make_interval(mins => $2)
                """,
                MAX_RENDER_ATTEMPTS,
                STALE_RENDER_MINUTES,
            )
            if force:
                row = await conn.fetchrow(
                    """
                    SELECT id
                    FROM videos
                    WHERE id = $1
                      AND audio_url IS NOT NULL
                      AND NOT (
                        render_status = 'rendering'
                        AND COALESCE(render_heartbeat_at, render_started_at, created_at)
                            >= now() - make_interval(mins => $2)
                      )
                    FOR UPDATE SKIP LOCKED
                    """,
                    video_id,
                    STALE_RENDER_MINUTES,
                )
            else:
                row = await conn.fetchrow(
                    """
                    SELECT id
                    FROM videos
                    WHERE audio_url IS NOT NULL
                      AND (
                        render_status = 'not_started'
                        OR (
                          render_status = 'failed'
                          AND render_attempt_count < $1
                          AND COALESCE(render_next_attempt_at, now()) <= now()
                        )
                        OR (
                          render_status = 'rendering'
                          AND render_attempt_count < $1
                          AND COALESCE(render_heartbeat_at, render_started_at, created_at)
                              < now() - make_interval(mins => $2)
                        )
                      )
                    ORDER BY COALESCE(render_requested_at, created_at), id
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                    """,
                    MAX_RENDER_ATTEMPTS,
                    STALE_RENDER_MINUTES,
                )
            if row is None:
                return None

            claimed = await conn.fetchrow(
                """
                UPDATE videos
                SET render_status = 'rendering',
                    render_attempt_count = CASE
                      WHEN $3 THEN 1
                      ELSE render_attempt_count + 1
                    END,
                    render_error = NULL,
                    render_next_attempt_at = NULL,
                    render_requested_at = CASE
                      WHEN $3 THEN now()
                      ELSE COALESCE(render_requested_at, created_at)
                    END,
                    render_started_at = now(),
                    render_finished_at = NULL,
                    render_heartbeat_at = now(),
                    render_worker_token = $2
                WHERE id = $1
                RETURNING id, featured_person, audio_url, tts_text,
                          render_attempt_count, render_worker_token,
                          rendered_audio_url, render_source_hash, video_path
                """,
                row["id"],
                token,
                force,
            )
            if claimed is None:
                return None
            logger.info(
                "Claimed video #%s render attempt %s",
                claimed["id"],
                claimed["render_attempt_count"],
            )
            return dict(claimed)
    finally:
        await conn.close()


async def touch_render_heartbeat(dsn: str, video_id: int, token: str) -> bool:
    conn = await _connect(dsn)
    try:
        result = await conn.execute(
            """
            UPDATE videos
            SET render_heartbeat_at = now()
            WHERE id = $1 AND render_status = 'rendering' AND render_worker_token = $2
            """,
            video_id,
            token,
        )
        return result == "UPDATE 1"
    finally:
        await conn.close()


async def owns_render_lease(dsn: str, video_id: int, token: str) -> bool:
    conn = await _connect(dsn)
    try:
        return bool(
            await conn.fetchval(
                """
                SELECT EXISTS(
                  SELECT 1 FROM videos
                  WHERE id = $1
                    AND render_status = 'rendering'
                    AND render_worker_token = $2
                )
                """,
                video_id,
                token,
            )
        )
    finally:
        await conn.close()


async def save_whisper_transcript(
    dsn: str,
    video_id: int,
    token: str,
    transcript: str,
) -> None:
    conn = await _connect(dsn)
    try:
        result = await conn.execute(
            """
            UPDATE videos
            SET whisper_transcript = $3, render_heartbeat_at = now()
            WHERE id = $1 AND render_worker_token = $2
            """,
            video_id,
            token,
            transcript,
        )
        if result != "UPDATE 1":
            raise RuntimeError(f"Lost render lease for video #{video_id}")
    finally:
        await conn.close()


async def save_render_done(
    dsn: str,
    video_id: int,
    token: str,
    *,
    video_path: str,
    audio_url: str,
    source_hash: str,
) -> None:
    conn = await _connect(dsn)
    try:
        result = await conn.execute(
            """
            UPDATE videos
            SET video_path = $3,
                rendered_audio_url = $4,
                render_source_hash = $5,
                render_status = 'done',
                render_error = NULL,
                render_next_attempt_at = NULL,
                render_finished_at = now(),
                render_heartbeat_at = now(),
                render_worker_token = NULL
            WHERE id = $1 AND render_status = 'rendering' AND render_worker_token = $2
            """,
            video_id,
            token,
            video_path,
            audio_url,
            source_hash,
        )
        if result != "UPDATE 1":
            raise RuntimeError(f"Lost render lease before completing video #{video_id}")
        logger.info("Video #%s render done -> %s", video_id, video_path)
    finally:
        await conn.close()


async def mark_render_failed(
    dsn: str,
    video_id: int,
    token: str,
    error: str,
) -> None:
    conn = await _connect(dsn)
    try:
        result = await conn.execute(
            """
            UPDATE videos
            SET render_status = 'failed',
                render_error = $3,
                render_next_attempt_at = CASE render_attempt_count
                  WHEN 1 THEN now() + interval '1 minute'
                  WHEN 2 THEN now() + interval '5 minutes'
                  WHEN 3 THEN now() + interval '15 minutes'
                  ELSE NULL
                END,
                render_finished_at = now(),
                render_heartbeat_at = now(),
                render_worker_token = NULL
            WHERE id = $1 AND render_worker_token = $2
            """,
            video_id,
            token,
            error[:4000],
        )
        if result == "UPDATE 1":
            logger.warning("Video #%s render marked failed: %s", video_id, error)
    finally:
        await conn.close()
