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
from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse

import asyncpg
import httpx

logger = logging.getLogger(__name__)

# asyncpg does not support these Neon/PgBouncer-specific URL params.
# Passing them causes SSL handshake failures / TimeoutError.
_ASYNCPG_UNSUPPORTED_PARAMS = {"channel_binding", "options"}


def _sanitize_dsn(dsn: str) -> str:
    """Strip params asyncpg doesn't understand. Keep the pooler hostname so we
    go through pgbouncer (always-on, no cold-start) rather than direct Neon compute."""
    parsed = urlparse(dsn)
    params = [(k, v) for k, v in parse_qsl(parsed.query) if k not in _ASYNCPG_UNSUPPORTED_PARAMS]
    return urlunparse(parsed._replace(query=urlencode(params)))


async def _connect(dsn: str) -> asyncpg.Connection:
    """Open a connection through Neon pgbouncer (pooler URL).
    statement_cache_size=0 is required for pgbouncer transaction mode."""
    return await asyncpg.connect(_sanitize_dsn(dsn), statement_cache_size=0, timeout=30)


async def trigger_chain_cycle(web_url: str, dashboard_secret: str) -> None:
    """Ping the Next.js chain endpoint so it immediately consumes the job we
    just marked 'done' instead of waiting for a manual button press.

    Non-fatal: logs a warning on failure and returns — the pipeline will still
    make progress next time the operator presses 'Chạy pipeline'.
    """
    if not web_url or not dashboard_secret:
        return
    url = web_url.rstrip("/") + "/api/cron/process-jobs"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers={"Authorization": f"Bearer {dashboard_secret}"})
        if r.status_code == 200:
            logger.info("Chain cycle triggered (%s)", url)
        else:
            logger.warning("Chain trigger returned HTTP %s from %s", r.status_code, url)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Chain trigger failed (non-fatal): %s", exc)

# Stages this worker knows how to execute. P5/P6 batches are also Playwright
# (ChatGPT) jobs from the worker's point of view — same claim/run/complete flow.
SUPPORTED_STAGES = ("P1", "P2", "P3", "P4", "P_score", "P5", "P6")


async def claim_next_job(dsn: str, *, stages: tuple[str, ...] = SUPPORTED_STAGES) -> dict | None:
    """Atomically claim one pending job (oldest first) and mark it 'running'.

    Returns the claimed row as a dict, or None if no pending job is available.
    """
    conn = await _connect(dsn)
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
    """Mark a job done and store its result text (the raw ChatGPT response).
    Clears error_message so retried-then-succeeded jobs don't show a stale error."""
    conn = await _connect(dsn)
    try:
        await conn.execute(
            """
            UPDATE jobs
            SET status = 'done', result = $2, finished_at = NOW(), error_message = NULL
            WHERE id = $1
            """,
            job_id, result,
        )
        logger.info("Completed job id=%s", job_id)
    finally:
        await conn.close()


async def fail_job(dsn: str, job_id: int, *, error_message: str, retry_count: int) -> None:
    """Mark a job permanently/terminally failed and record the error +
    final retry counter. Hard-failed jobs are terminal — nothing in the
    Next.js orchestrator's chain.ts ever consumes them; they surface on the
    Needs Attention dashboard + a Telegram alert and require a manual
    POST /api/jobs/:id/retry to come back to life.

    Call this either for non-transient errors (unexpected exceptions — likely
    real bugs, not worth auto-retrying) or once a transient failure has
    exhausted its retry budget (see retry_transient_job + worker.py's
    MAX_TRANSIENT_RETRIES / process_job)."""
    conn = await _connect(dsn)
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


async def retry_transient_job(dsn: str, job_id: int, *, error_message: str, retry_count: int) -> None:
    """Send a job that hit a *transient* failure (ChatGPT timeout/hiccup) back
    to 'pending' for another automatic attempt — unlike fail_job, this keeps
    the job alive in the queue. Persists the incremented retry_count and the
    error text (for visibility on the dashboard) so the caller's retry-budget
    check (worker.py: MAX_TRANSIENT_RETRIES) has up-to-date state to compare
    against on the next attempt, and can hard-fail once the budget runs out."""
    conn = await _connect(dsn)
    try:
        await conn.execute(
            """
            UPDATE jobs
            SET status = 'pending', error_message = $2, retry_count = $3,
                started_at = NULL, finished_at = NULL
            WHERE id = $1
            """,
            job_id, error_message, retry_count,
        )
        logger.info("Requeued job id=%s for transient retry (attempt %d)", job_id, retry_count)
    finally:
        await conn.close()


async def requeue_job(dsn: str, job_id: int) -> None:
    """Reset a failed job back to pending for another attempt.

    NOTE: dead code from this worker's point of view — the only sanctioned
    revival path for a hard-failed job is the Next.js dashboard's authenticated
    `POST /api/jobs/:id/retry` route (web/app/api/jobs/[id]/retry/route.ts),
    which performs the equivalent reset directly via Drizzle. Kept here (a)
    for parity/documentation of what a "clean requeue" must reset, and (b) in
    case a future worker-side requeue path is added — in which case, MUST also
    clear `consumed_at`, exactly like the dashboard route now does (see its
    docstring for the stranded-job bug this guards against: a job whose
    failure was already notified — `consumed_at` stamped — getting retried,
    completing successfully, and then being silently skipped forever by
    `processDoneJob`'s `if (... || job.consumedAt) return` guard)."""
    conn = await _connect(dsn)
    try:
        await conn.execute(
            """
            UPDATE jobs
            SET status = 'pending', error_message = NULL, started_at = NULL,
                finished_at = NULL, consumed_at = NULL
            WHERE id = $1
            """,
            job_id,
        )
        logger.info("Requeued job id=%s", job_id)
    finally:
        await conn.close()


async def fetch_job(dsn: str, job_id: int) -> dict | None:
    conn = await _connect(dsn)
    try:
        row = await conn.fetchrow("SELECT * FROM jobs WHERE id = $1", job_id)
        return dict(row) if row else None
    finally:
        await conn.close()


# ── Ancient Humans pipeline (ah_jobs table) ─────────────────────────────────
# Separate functions so any change here can NEVER affect the web/ pipeline.
# ah_jobs uses TEXT columns (not enums) and has no prompt_version_id.

AH_SUPPORTED_STAGES = ("S1", "S2", "S3", "S4")


async def _hit_url(url: str, secret: str) -> None:
    """Fire-and-forget GET with Bearer auth. Non-fatal on any error."""
    if not url or not secret:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers={"Authorization": f"Bearer {secret}"})
        if r.status_code == 200:
            logger.info("AH callback triggered (%s)", url)
        else:
            logger.warning("AH callback returned HTTP %s from %s", r.status_code, url)
    except Exception as exc:  # noqa: BLE001
        logger.warning("AH callback failed (non-fatal): %s", exc)


async def claim_next_ah_job(dsn: str) -> dict | None:
    """Atomically claim one pending ah_job (oldest first) and mark it 'running'.

    Returns the claimed row as a dict with '_table'='ah_jobs', or None.
    Uses TEXT stage column — no enum cast needed.
    """
    conn = await _connect(dsn)
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT id, video_id, stage, prompt_text, retry_count, metadata
                FROM ah_jobs
                WHERE status = 'pending' AND stage = ANY($1::text[])
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
                """,
                list(AH_SUPPORTED_STAGES),
            )
            if row is None:
                return None

            await conn.execute(
                "UPDATE ah_jobs SET status = 'running', started_at = NOW() WHERE id = $1",
                row["id"],
            )
            logger.info("Claimed ah_job id=%s stage=%s video_id=%s", row["id"], row["stage"], row["video_id"])
            result = dict(row)
            result["_table"] = "ah_jobs"
            # Deserialise metadata from asyncpg's JSON string if needed
            if isinstance(result.get("metadata"), str):
                import json as _json
                result["metadata"] = _json.loads(result["metadata"])
            return result
    finally:
        await conn.close()


async def complete_ah_job(dsn: str, job_id: int, *, result: str, web2_secret: str = "") -> None:
    """Mark an ah_job done, store result, and fire its callback URL."""
    conn = await _connect(dsn)
    row = None
    try:
        row = await conn.fetchrow(
            """
            UPDATE ah_jobs
            SET status = 'done', result = $2, finished_at = NOW(), error_message = NULL
            WHERE id = $1
            RETURNING metadata
            """,
            job_id, result,
        )
        logger.info("Completed ah_job id=%s", job_id)
    finally:
        await conn.close()

    # Fire callback after releasing the DB connection
    if row is not None:
        import json as _json
        meta = row["metadata"]
        if isinstance(meta, str):
            meta = _json.loads(meta)
        callback_url = (meta or {}).get("web_callback_url", "")
        await _hit_url(callback_url, web2_secret)


async def fail_ah_job(dsn: str, job_id: int, *, error_message: str, retry_count: int) -> None:
    """Mark an ah_job permanently failed."""
    conn = await _connect(dsn)
    try:
        await conn.execute(
            """
            UPDATE ah_jobs
            SET status = 'failed', error_message = $2, retry_count = $3, finished_at = NOW()
            WHERE id = $1
            """,
            job_id, error_message, retry_count,
        )
        logger.info("Failed ah_job id=%s retry_count=%s: %s", job_id, retry_count, error_message)
    finally:
        await conn.close()


async def retry_transient_ah_job(dsn: str, job_id: int, *, error_message: str, retry_count: int) -> None:
    """Requeue an ah_job for a transient retry."""
    conn = await _connect(dsn)
    try:
        await conn.execute(
            """
            UPDATE ah_jobs
            SET status = 'pending', error_message = $2, retry_count = $3,
                started_at = NULL, finished_at = NULL
            WHERE id = $1
            """,
            job_id, error_message, retry_count,
        )
        logger.info("Requeued ah_job id=%s for transient retry (attempt %d)", job_id, retry_count)
    finally:
        await conn.close()


# ── Drifter 2077 pipeline (dr_jobs) ──────────────────────────────────────────
DR_SUPPORTED_STAGES = ("D0", "D1", "D2A", "D2B", "D2C", "D3", "D4")


async def claim_next_dr_job(dsn: str) -> dict | None:
    """Atomically claim one pending dr_job (oldest first) and mark it 'running'.

    Returns the claimed row as a dict with '_table'='dr_jobs', or None.
    """
    conn = await _connect(dsn)
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT id, episode_id, stage, prompt_text, retry_count, metadata
                FROM dr_jobs
                WHERE status = 'pending' AND stage = ANY($1::text[])
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
                """,
                list(DR_SUPPORTED_STAGES),
            )
            if row is None:
                return None

            await conn.execute(
                "UPDATE dr_jobs SET status = 'running', started_at = NOW() WHERE id = $1",
                row["id"],
            )
            logger.info("Claimed dr_job id=%s stage=%s episode_id=%s", row["id"], row["stage"], row["episode_id"])
            result = dict(row)
            result["_table"] = "dr_jobs"
            # Mirror the ah field name so worker routing can use job["video_id"].
            result["video_id"] = row["episode_id"]
            if isinstance(result.get("metadata"), str):
                import json as _json
                result["metadata"] = _json.loads(result["metadata"])
            return result
    finally:
        await conn.close()


async def complete_dr_job(dsn: str, job_id: int, *, result: str, web3_secret: str = "") -> None:
    """Mark a dr_job done, store result, and fire its callback URL."""
    conn = await _connect(dsn)
    row = None
    try:
        row = await conn.fetchrow(
            """
            UPDATE dr_jobs
            SET status = 'done', result = $2, finished_at = NOW(), error_message = NULL
            WHERE id = $1
            RETURNING metadata
            """,
            job_id, result,
        )
        logger.info("Completed dr_job id=%s", job_id)
    finally:
        await conn.close()

    if row is not None:
        import json as _json
        meta = row["metadata"]
        if isinstance(meta, str):
            meta = _json.loads(meta)
        callback_url = (meta or {}).get("web_callback_url", "")
        await _hit_url(callback_url, web3_secret)


async def fail_dr_job(dsn: str, job_id: int, *, error_message: str, retry_count: int) -> None:
    """Mark a dr_job permanently failed."""
    conn = await _connect(dsn)
    try:
        await conn.execute(
            """
            UPDATE dr_jobs
            SET status = 'failed', error_message = $2, retry_count = $3, finished_at = NOW()
            WHERE id = $1
            """,
            job_id, error_message, retry_count,
        )
        logger.info("Failed dr_job id=%s retry_count=%s: %s", job_id, retry_count, error_message)
    finally:
        await conn.close()


async def retry_transient_dr_job(dsn: str, job_id: int, *, error_message: str, retry_count: int) -> None:
    """Requeue a dr_job for a transient retry."""
    conn = await _connect(dsn)
    try:
        await conn.execute(
            """
            UPDATE dr_jobs
            SET status = 'pending', error_message = $2, retry_count = $3,
                started_at = NULL, finished_at = NULL
            WHERE id = $1
            """,
            job_id, error_message, retry_count,
        )
        logger.info("Requeued dr_job id=%s for transient retry (attempt %d)", job_id, retry_count)
    finally:
        await conn.close()
