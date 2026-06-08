#!/usr/bin/env python3
"""Thin Playwright worker — polls the `jobs` table (Postgres), runs each job's
prompt through ChatGPT, and writes the result back. All orchestration
(which stage comes next, prompt interpolation, retries, scoring, anti-dup,
prompt versioning) lives in the Next.js app (web/); this process only knows
how to "run a prompt through ChatGPT and report back".

Run manually on the Mac when you want the pipeline to make progress:
    python -m auto_yt.worker
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import asyncpg
from playwright.async_api import async_playwright

from auto_yt.paths import ACCOUNT_PATH, DATA_DIR, gpt_profile_dir
from auto_yt.services.chat_gpt import ChatGPTResponseError, send_prompt
from auto_yt.services.chatgpt_login import ChatGPTLoginError, login_gpt_auto, restore_session
from auto_yt.services.job_queue import claim_next_job, complete_job, fail_job

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DB_CONFIG_PATH = DATA_DIR / "db_config.json"
POLL_INTERVAL_S = 15
PROMPT_TIMEOUT_S = 240
MAX_TRANSIENT_RETRIES = 3


def load_database_url() -> str:
    dsn = os.getenv("DATABASE_URL", "").strip()
    if dsn:
        return dsn
    if DB_CONFIG_PATH.exists():
        data = json.loads(DB_CONFIG_PATH.read_text(encoding="utf-8"))
        dsn = str(data.get("DATABASE_URL") or data.get("POSTGRES_URL") or "").strip()
        if dsn:
            return dsn
    raise RuntimeError(
        "Missing DATABASE_URL. Set env DATABASE_URL or create data/db_config.json "
        "with {\"DATABASE_URL\": \"postgres://...sslmode=require\"}."
    )


def load_account() -> dict:
    data = json.loads(ACCOUNT_PATH.read_text(encoding="utf-8"))
    return data.get("gpt_account1", data)


async def ensure_logged_in(page, account: dict) -> dict:
    saved_cookies = account.get("session_cookie", [])
    if saved_cookies:
        logger.info("Trying restore_session with %d saved cookies...", len(saved_cookies))
        try:
            return await restore_session(saved_cookies, page)
        except ChatGPTLoginError as exc:
            logger.warning("restore_session failed: %s", exc)
    logger.info("Falling back to full login...")
    return await login_gpt_auto(account, page)


async def record_heartbeat(dsn: str, status: str) -> None:
    """Mirrors web/lib/db/repo/channel-config.ts recordWorkerHeartbeat — same
    upsert-by-key shape, written in raw SQL since the worker has no Drizzle access.
    """
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(
            """
            INSERT INTO channel_config (key, worker_last_seen_at, worker_last_status, updated_at)
            VALUES ('worker_heartbeat', NOW(), $1::worker_status, NOW())
            ON CONFLICT (key) DO UPDATE
            SET worker_last_seen_at = NOW(), worker_last_status = $1::worker_status, updated_at = NOW()
            """,
            status,
        )
    finally:
        await conn.close()


async def process_job(page, dsn: str, job: dict) -> None:
    job_id = job["id"]
    stage = job["stage"]
    prompt_text = job["prompt_text"]
    retry_count = job["retry_count"]

    logger.info("Running job id=%s stage=%s (prompt %d chars)", job_id, stage, len(prompt_text))
    try:
        response = await send_prompt(prompt_text, page, timeout_s=PROMPT_TIMEOUT_S)
    except ChatGPTResponseError as exc:
        next_retry = retry_count + 1
        logger.warning("Job id=%s transient failure (attempt %d): %s", job_id, next_retry, exc)
        await fail_job(dsn, job_id, error_message=str(exc), retry_count=next_retry)
        return
    except Exception as exc:  # noqa: BLE001 - surface unexpected errors as a failed job, not a crash
        logger.exception("Job id=%s unexpected error", job_id)
        await fail_job(dsn, job_id, error_message=f"{exc.__class__.__name__}: {exc}", retry_count=retry_count + 1)
        return

    await complete_job(dsn, job_id, result=response)


async def run() -> None:
    dsn = load_database_url()
    account = load_account()

    pw = await async_playwright().start()
    ctx = await pw.chromium.launch_persistent_context(
        str(gpt_profile_dir("PROFILE_GPT_1")),
        headless=False,
        args=["--disable-blink-features=AutomationControlled"],
        viewport={"width": 1280, "height": 800},
    )
    page = ctx.pages[0] if ctx.pages else await ctx.new_page()
    page.set_default_timeout(60_000)

    try:
        result = await ensure_logged_in(page, account)
        logger.info("Logged in user: %s", result.get("user", {}))
        await record_heartbeat(dsn, "running")

        logger.info("Worker started — polling every %ds. Press Ctrl+C to stop.", POLL_INTERVAL_S)
        while True:
            try:
                job = await claim_next_job(dsn)
                if job is None:
                    await record_heartbeat(dsn, "running")
                    await asyncio.sleep(POLL_INTERVAL_S)
                    continue

                await process_job(page, dsn, job)
                await record_heartbeat(dsn, "running")
            except (ChatGPTLoginError, ChatGPTResponseError) as exc:
                logger.error("ChatGPT error during poll loop: %s", exc)
                await asyncio.sleep(POLL_INTERVAL_S)
            except asyncpg.PostgresError as exc:
                logger.error("Database error during poll loop: %s", exc)
                await asyncio.sleep(POLL_INTERVAL_S)
    finally:
        await record_heartbeat(dsn, "stopped")
        await ctx.close()
        await pw.stop()


def main() -> None:
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        logger.info("Worker stopped by user.")


if __name__ == "__main__":
    main()
