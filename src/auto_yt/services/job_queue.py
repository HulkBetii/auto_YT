"""Postgres-backed job queue — the ONLY contract between this Python/Playwright
worker and the Next.js orchestrator (web/). Column names match the Drizzle
schema in web/lib/db/schema/jobs.ts exactly; there is no shared ORM, so any
change to that schema must be mirrored here by hand.

Claiming uses SELECT ... FOR UPDATE SKIP LOCKED so multiple worker instances
(or a worker + manual psql session) can never grab the same job.
"""

from __future__ import annotations

import logging
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)

# Stages this worker knows how to execute. P5/P6 batches are also Playwright
# (ChatGPT) jobs from the worker's point of view — same claim/run/complete flow.
SUPPORTED_STAGES = ("P1", "P2", "P3", "P4", "P_score", "P5", "P6")


async def claim_next_job(dsn: str, *, stages: tuple[str, ...] = SUPPORTED_STAGES) -> dict | None:
    """Atomically claim one pending job (oldest first) and mark it 'running'.

    Returns the claimed row as a dict, or None if no pending job is available.
    """
    conn = await asyncpg.connect(dsn)
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT id, video_id, stage, prompt_text, prompt_version_id, retry_count
                FROM jobs
                WHERE status = 'pending' AND stage = ANY($1::job_stage[])
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
                """,
                list(stages),
            )
            if row is None:
                return None

            await conn.execute(
                """
                UPDATE jobs
                SET status = 'running', started_at = NOW()
                WHERE id = $1
                """,
                row["id"],
            )
            logger.info("Claimed job id=%s stage=%s video_id=%s", row["id"], row["stage"], row["video_id"])
            return dict(row)
    finally:
        await conn.close()


async def complete_job(dsn: str, job_id: int, *, result: str) -> None:
    """Mark a job done and store its result text (the raw ChatGPT response)."""
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(
            """
            UPDATE jobs
            SET status = 'done', result = $2, finished_at = NOW()
            WHERE id = $1
            """,
            job_id, result,
        )
        logger.info("Completed job id=%s", job_id)
    finally:
        await conn.close()


async def fail_job(dsn: str, job_id: int, *, error_message: str, retry_count: int) -> None:
    """Mark a job failed and record the error + updated retry counter.

    The orchestrator (Next.js cron) decides whether to requeue based on
    retry_count vs its own retry-budget config — this function only persists state.
    """
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(
            """
            UPDATE jobs
            SET status = 'failed', error_message = $2, retry_count = $3, finished_at = NOW()
            WHERE id = $1
            """,
            job_id, error_message, retry_count,
        )
        logger.info("Failed job id=%s retry_count=%s: %s", job_id, retry_count, error_message)
    finally:
        await conn.close()


async def requeue_job(dsn: str, job_id: int) -> None:
    """Reset a failed job back to pending for another attempt (used by retry logic)."""
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(
            """
            UPDATE jobs
            SET status = 'pending', error_message = NULL, started_at = NULL, finished_at = NULL
            WHERE id = $1
            """,
            job_id,
        )
        logger.info("Requeued job id=%s", job_id)
    finally:
        await conn.close()


async def fetch_job(dsn: str, job_id: int) -> dict | None:
    conn = await asyncpg.connect(dsn)
    try:
        row = await conn.fetchrow("SELECT * FROM jobs WHERE id = $1", job_id)
        return dict(row) if row else None
    finally:
        await conn.close()
