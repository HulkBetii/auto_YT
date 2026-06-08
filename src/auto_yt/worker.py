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


async def _page_alive(page) -> bool:
    """Cheap liveness probe — `page.is_closed()` alone misses the case where
    the underlying frame/context died (crash, manual close, navigation wipe)
    but the Page wrapper object hasn't flipped its closed flag yet. A trivial
    `evaluate` round-trips through the real target and raises TargetClosedError
    if it's actually gone."""
    try:
        if page.is_closed():
            return False
        await page.evaluate("1")
        return True
    except Exception:
        return False


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


# Video statuses at which a per-video ChatGPT tab is no longer needed and gets
# closed to free resources. `needs_retry` is intentionally excluded — the video
# isn't done, and reusing the same conversation for the retry lets ChatGPT see
# why its previous attempt scored low. P5/P6 (which only happen much later,
# once analytics roll in) get a *fresh* tab when their time comes — simpler
# than keeping hundreds of idle tabs alive for weeks.
TERMINAL_VIDEO_STATUSES = ("ready_to_publish", "needs_attention")


async def fetch_video_status(dsn: str, video_id: int) -> str | None:
    conn = await asyncpg.connect(dsn)
    try:
        return await conn.fetchval("SELECT status FROM videos WHERE id = $1", video_id)
    finally:
        await conn.close()


class TabManager:
    """Owns one Playwright page (= one ChatGPT conversation) per "routing key"
    so unrelated pieces of content never bleed context into each other, and
    related stages of the *same* piece keep their shared context:

      - P1 (topic generation) always runs in a single dedicated, long-lived
        "topic reservoir" tab/conversation. Reusing the same thread across
        every P1 run means ChatGPT can see every topic it has ever proposed
        and naturally avoid repeating itself — a second line of defense on
        top of the embedding-based anti-dup check in the orchestrator.
        ("Pinning" a tab is a Chrome tab-strip UI affordance with no
        Playwright/CDP automation hook — see _try_pin below; what actually
        matters for correctness is that *this exact Page object* is reused,
        which is what we guarantee here regardless of its visual pin state.)

      - P2..P_score (and later P5/P6) each get their own tab/conversation,
        keyed by video_id, lazily opened on first use and reused across that
        video's remaining stages — so e.g. a P3 retry can "see" the P2
        outline it's continuing from, without any cross-video noise.

    Dead tabs (crashed, closed, torn-down frame — the TargetClosedError class
    of failure that used to wedge the whole worker, see git history) are
    detected via `_page_alive` and transparently replaced on next use.
    """

    def __init__(self, ctx, account: dict):
        self.ctx = ctx
        self.account = account
        self.topic_page = None
        self.video_pages: dict[int, object] = {}

    async def _new_logged_in_page(self):
        page = await self.ctx.new_page()
        page.set_default_timeout(60_000)
        result = await ensure_logged_in(page, self.account)
        logger.info("New ChatGPT tab ready. Logged in user: %s", result.get("user", {}))
        return page

    async def _try_pin(self, page) -> None:
        """Best-effort cosmetic pin — Chrome's tab-strip pin state isn't part
        of the page/target model CDP exposes, so there is nothing reliable to
        call here. We deliberately don't fake it with fragile UI clicking on
        browser chrome (which Playwright can't even address). If you want the
        topic tab visually pinned for your own monitoring, right-click it in
        the visible browser window — it has zero effect on automation either
        way, since what matters is that we keep reusing the same Page object."""
        return

    async def bootstrap(self) -> None:
        """Open & log into the topic-reservoir tab eagerly at startup so a
        broken login surfaces immediately rather than on the first P1 job."""
        await self._get_topic_page()

    async def _get_topic_page(self):
        if self.topic_page is None or not await _page_alive(self.topic_page):
            if self.topic_page is not None:
                logger.warning("Topic-reservoir tab is dead — reopening (e.g. account/profile changed)...")
                try:
                    await self.topic_page.close()
                except Exception:
                    pass
            logger.info("Opening dedicated 'topic reservoir' tab for P1...")
            self.topic_page = await self._new_logged_in_page()
            await self._try_pin(self.topic_page)
        return self.topic_page

    async def _get_video_page(self, video_id: int):
        page = self.video_pages.get(video_id)
        if page is None or not await _page_alive(page):
            if page is not None:
                logger.warning("Tab for video #%s is dead — reopening...", video_id)
                try:
                    await page.close()
                except Exception:
                    pass
            logger.info("Opening dedicated tab for video #%s...", video_id)
            page = await self._new_logged_in_page()
            self.video_pages[video_id] = page
        return page

    async def get_page_for(self, job: dict):
        """Routes a claimed job to the right conversation: the shared topic
        reservoir for P1, or this video's dedicated tab for everything else."""
        if job["stage"] == "P1":
            return await self._get_topic_page()
        video_id = job.get("video_id")
        if video_id is None:
            # Defensive fallback — every non-P1 stage carries a video_id in
            # practice (enforced by the orchestrator), but never crash the
            # loop over a missing one; just use a scratch tab for this job.
            logger.warning("Job id=%s stage=%s has no video_id — using a scratch tab", job["id"], job["stage"])
            return await self._new_logged_in_page()
        return await self._get_video_page(video_id)

    async def sweep_terminal_tabs(self, dsn: str) -> None:
        """Close & forget any open per-video tab whose video has reached a
        terminal status, freeing resources without losing context for videos
        still mid-pipeline (including needs_retry loops).

        This has to be a periodic sweep over *all* open tabs rather than a
        one-shot check right after this worker completes a job: the actual
        status write (e.g. scoring -> ready_to_publish) happens later and
        asynchronously, performed by the Next.js orchestrator's job-chaining
        cron when it consumes the job we just marked 'done' — not by us. So
        "check this video's status immediately after finishing its job" is
        structurally always one beat too early for that video's *last* job
        (there's no follow-up job to trigger a recheck). Sweeping every poll
        tick catches the transition whenever the cron actually lands it."""
        for video_id, page in list(self.video_pages.items()):
            try:
                status = await fetch_video_status(dsn, video_id)
            except Exception:
                continue
            if status in TERMINAL_VIDEO_STATUSES:
                page = self.video_pages.pop(video_id, None)
                if page is not None:
                    logger.info("Video #%s reached '%s' — closing its dedicated tab.", video_id, status)
                    try:
                        await page.close()
                    except Exception:
                        pass

    async def close_all(self) -> None:
        for video_id, page in list(self.video_pages.items()):
            try:
                await page.close()
            except Exception:
                pass
        self.video_pages.clear()
        if self.topic_page is not None:
            try:
                await self.topic_page.close()
            except Exception:
                pass
            self.topic_page = None


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

    # Close whatever blank tab the persistent profile opens by default — every
    # conversation we use from here on is opened (and logged in) on demand by
    # TabManager, keyed by what the job actually is (P1 reservoir vs. per-video).
    for stray in list(ctx.pages):
        try:
            await stray.close()
        except Exception:
            pass

    tabs = TabManager(ctx, account)

    try:
        await tabs.bootstrap()
        await record_heartbeat(dsn, "running")

        logger.info("Worker started — polling every %ds. Press Ctrl+C to stop.", POLL_INTERVAL_S)
        while True:
            try:
                job = await claim_next_job(dsn)
                if job is None:
                    await tabs.sweep_terminal_tabs(dsn)
                    await record_heartbeat(dsn, "running")
                    await asyncio.sleep(POLL_INTERVAL_S)
                    continue

                page = await tabs.get_page_for(job)
                await process_job(page, dsn, job)
                await tabs.sweep_terminal_tabs(dsn)
                await record_heartbeat(dsn, "running")
            except (ChatGPTLoginError, ChatGPTResponseError) as exc:
                logger.error("ChatGPT error during poll loop: %s", exc)
                await asyncio.sleep(POLL_INTERVAL_S)
            except asyncpg.PostgresError as exc:
                logger.error("Database error during poll loop: %s", exc)
                await asyncio.sleep(POLL_INTERVAL_S)
            except Exception as exc:  # noqa: BLE001 - keep the loop alive; a tab-recovery hiccup shouldn't crash the whole worker
                logger.exception("Unexpected error during poll loop: %s", exc)
                await asyncio.sleep(POLL_INTERVAL_S)
    finally:
        await record_heartbeat(dsn, "stopped")
        await tabs.close_all()
        await ctx.close()
        await pw.stop()


def main() -> None:
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        logger.info("Worker stopped by user.")


if __name__ == "__main__":
    main()
