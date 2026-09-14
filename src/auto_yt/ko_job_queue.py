"""Database contract for the Korean Playwright job queue."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import asyncpg
import httpx

logger = logging.getLogger(__name__)

_ASYNCPG_UNSUPPORTED_PARAMS = {"channel_binding", "options"}


def _sanitize_dsn(dsn: str) -> str:
    parsed = urlparse(dsn)
    params = [
        (key, value)
        for key, value in parse_qsl(parsed.query)
        if key not in _ASYNCPG_UNSUPPORTED_PARAMS
    ]
    return urlunparse(parsed._replace(query=urlencode(params)))


async def _connect(dsn: str) -> asyncpg.Connection:
    return await asyncpg.connect(
        _sanitize_dsn(dsn),
        statement_cache_size=0,
        timeout=30,
    )


async def claim_next_ko_job(dsn: str) -> dict[str, Any] | None:
    conn = await _connect(dsn)
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT
                    j.id,
                    j.video_id,
                    j.section_id,
                    j.kind,
                    j.model_label,
                    j.effort,
                    j.prompt_text,
                    j.attachment_path,
                    j.retry_count,
                    j.validation_attempt,
                    j.metadata
                FROM ko_jobs j
                JOIN ko_videos v ON v.id = j.video_id
                WHERE j.status = 'pending'
                  AND v.status IN (
                      'source_audit_pending',
                      'outline_pending',
                      'sections_pending',
                      'final_review_pending'
                  )
                ORDER BY j.created_at ASC, j.id ASC
                FOR UPDATE OF j SKIP LOCKED
                LIMIT 1
                """
            )
            if row is None:
                return None
            await conn.execute(
                """
                UPDATE ko_jobs
                SET status = 'running', started_at = NOW(), error_message = NULL
                WHERE id = $1
                """,
                row["id"],
            )
            if row["section_id"] is not None:
                await conn.execute(
                    """
                    UPDATE ko_sections
                    SET status = 'generating', attempts = attempts + 1, updated_at = NOW()
                    WHERE id = $1
                    """,
                    row["section_id"],
                )
            result = dict(row)
            if isinstance(result.get("metadata"), str):
                result["metadata"] = json.loads(result["metadata"])
            return result
    finally:
        await conn.close()


async def complete_ko_job(dsn: str, job_id: int, result: str) -> None:
    conn = await _connect(dsn)
    try:
        await conn.execute(
            """
            UPDATE ko_jobs
            SET status = 'done', result = $2, error_message = NULL, finished_at = NOW()
            WHERE id = $1 AND status = 'running'
            """,
            job_id,
            result,
        )
    finally:
        await conn.close()


async def retry_transient_ko_job(
    dsn: str,
    job_id: int,
    *,
    error_message: str,
    retry_count: int,
) -> None:
    conn = await _connect(dsn)
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE ko_jobs
                SET status = 'pending', retry_count = $2, error_message = $3,
                    started_at = NULL, finished_at = NULL
                WHERE id = $1
                RETURNING section_id
                """,
                job_id,
                retry_count,
                error_message[:4000],
            )
            if row and row["section_id"] is not None:
                await conn.execute(
                    "UPDATE ko_sections SET status = 'pending', updated_at = NOW() WHERE id = $1",
                    row["section_id"],
                )
    finally:
        await conn.close()


async def fail_ko_job(
    dsn: str,
    job_id: int,
    *,
    error_message: str,
    retry_count: int,
) -> None:
    conn = await _connect(dsn)
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE ko_jobs
                SET status = 'failed', retry_count = $2, error_message = $3,
                    finished_at = NOW(), consumed_at = NULL
                WHERE id = $1
                RETURNING section_id
                """,
                job_id,
                retry_count,
                error_message[:4000],
            )
            if row and row["section_id"] is not None:
                await conn.execute(
                    """
                    UPDATE ko_sections
                    SET status = 'failed', validation_errors = $2::jsonb, updated_at = NOW()
                    WHERE id = $1
                    """,
                    row["section_id"],
                    json.dumps([error_message[:4000]], ensure_ascii=False),
                )
    finally:
        await conn.close()


async def get_ko_conversation_url(dsn: str, video_id: int) -> str | None:
    conn = await _connect(dsn)
    try:
        value = await conn.fetchval(
            "SELECT conversation_url FROM ko_videos WHERE id = $1",
            video_id,
        )
        return value if isinstance(value, str) and value.startswith("https://chatgpt.com/c/") else None
    finally:
        await conn.close()


async def save_ko_conversation_url(dsn: str, video_id: int, url: str) -> None:
    if not url.startswith("https://chatgpt.com/c/"):
        raise ValueError(f"Invalid ChatGPT conversation URL: {url}")
    conn = await _connect(dsn)
    try:
        await conn.execute(
            """
            UPDATE ko_videos
            SET conversation_url = $2, updated_at = NOW()
            WHERE id = $1
            """,
            video_id,
            url,
        )
    finally:
        await conn.close()


async def set_ko_config(dsn: str, key: str, value: str) -> None:
    conn = await _connect(dsn)
    try:
        await conn.execute(
            """
            INSERT INTO ko_channel_config (key, value, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            """,
            key,
            value,
        )
    finally:
        await conn.close()


async def record_ko_heartbeat(
    dsn: str,
    state: str,
    *,
    error: str = "",
    profile_locked: bool = False,
) -> None:
    conn = await _connect(dsn)
    try:
        async with conn.transaction():
            values = {
                "worker_last_seen": datetime.now(timezone.utc).isoformat(),
                "worker_state": state,
                "worker_error": error[:4000],
                "profile_locked": "true" if profile_locked else "false",
            }
            for key, value in values.items():
                await conn.execute(
                    """
                    INSERT INTO ko_channel_config (key, value, updated_at)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
                    """,
                    key,
                    value,
                )
    finally:
        await conn.close()


async def trigger_ko_chain(web_url: str, dashboard_secret: str) -> None:
    if not web_url:
        return
    headers = {"Authorization": f"Bearer {dashboard_secret}"} if dashboard_secret else {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                web_url.rstrip("/") + "/api/pipeline/run",
                headers=headers,
            )
        if response.status_code != 200:
            logger.warning("KO chain callback returned HTTP %s", response.status_code)
    except Exception as exc:  # noqa: BLE001
        logger.warning("KO chain callback failed: %s", exc)
