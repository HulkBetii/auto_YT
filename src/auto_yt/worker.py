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
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright

from auto_yt.paths import ACCOUNT_PATH, DATA_DIR, gpt_profile_dir
from auto_yt.services.chat_gpt import ChatGPTResponseError, send_prompt
from auto_yt.services.chatgpt_login import ChatGPTLoginError, login_gpt_auto, restore_session
from auto_yt.services.job_queue import (
    claim_next_job, complete_job, fail_job, retry_transient_job, trigger_chain_cycle,
    claim_next_ah_job, complete_ah_job, fail_ah_job, retry_transient_ah_job,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DB_CONFIG_PATH = DATA_DIR / "db_config.json"
POLL_INTERVAL_S = 30
PROMPT_TIMEOUT_S = 360
WEB2_CHAIN_TICK_INTERVAL_S = 5 * 60

# How many times a *transient* ChatGPT failure (timeout, no-response, etc. —
# ChatGPTResponseError) gets automatically retried in-place before the job is
# hard-failed (terminal `failed` status + Telegram alert + manual /retry
# needed). Caught live during e2e testing 2026-06-08: this constant existed
# but was never actually consulted — every transient hiccup (e.g. "No new
# assistant message appeared within 240s", which happens routinely under
# normal ChatGPT load) went straight to a hard failure. See process_job.
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


def load_chain_config() -> tuple[str, str]:
    """Return (web_url, dashboard_secret) for triggering the chain cycle.

    Reads from env vars first, then falls back to db_config.json under the
    keys PIPELINE_WEB_URL / DASHBOARD_SECRET. Returns ("", "") if neither is
    available — trigger_chain_cycle will silently skip in that case.
    """
    web_url = os.getenv("PIPELINE_WEB_URL", "").strip()
    secret = os.getenv("DASHBOARD_SECRET", "").strip()
    if web_url and secret:
        return web_url, secret
    if DB_CONFIG_PATH.exists():
        try:
            data = json.loads(DB_CONFIG_PATH.read_text(encoding="utf-8"))
            web_url = web_url or str(data.get("PIPELINE_WEB_URL") or "").strip()
            secret = secret or str(data.get("DASHBOARD_SECRET") or "").strip()
        except Exception:
            pass
    if not web_url or not secret:
        logger.warning(
            "PIPELINE_WEB_URL / DASHBOARD_SECRET not set — "
            "chain cycle will not be auto-triggered after each job. "
            "Add both to data/db_config.json or env to fix."
        )
    return web_url, secret


def load_web2_config() -> tuple[str, str]:
    """Return (web2_url, web2_dashboard_secret) for firing ah_job callbacks.

    Reads WEB2_URL / WEB2_DASHBOARD_SECRET from env, then db_config.json.
    Returns ("", "") if not configured — _hit_url silently skips in that case.
    """
    url = os.getenv("WEB2_URL", "").strip()
    secret = os.getenv("WEB2_DASHBOARD_SECRET", "").strip()
    if url and secret:
        return url, secret
    if DB_CONFIG_PATH.exists():
        try:
            data = json.loads(DB_CONFIG_PATH.read_text(encoding="utf-8"))
            url = url or str(data.get("WEB2_URL") or "").strip()
            secret = secret or str(data.get("WEB2_DASHBOARD_SECRET") or "").strip()
        except Exception:
            pass
    if not url or not secret:
        logger.warning(
            "WEB2_URL / WEB2_DASHBOARD_SECRET not set — "
            "ah_jobs callbacks will not fire. Add both to data/db_config.json or env."
        )
    return url, secret


def load_account() -> dict:
    data = json.loads(ACCOUNT_PATH.read_text(encoding="utf-8"))
    return data.get("gpt_account1", data)


async def run_ah_tts_and_whisper(dsn: str, web2_url: str, web2_secret: str) -> bool:
    """Find one tts_pending Ancient-Humans video and process it with OpenAI TTS + Whisper.

    Runs locally (no Vercel timeout). Returns True if TTS was processed.
    """
    from auto_yt.services.job_queue import _sanitize_dsn, _hit_url
    import httpx, json as _json, tempfile

    conn = await asyncpg.connect(_sanitize_dsn(dsn), timeout=30)
    try:
        row = await conn.fetchrow(
            "SELECT id, script, chosen_topic, voice_id FROM ah_videos "
            "WHERE status = 'tts_pending' AND (audio_url IS NULL OR audio_url = 'tts_submitting') "
            "ORDER BY updated_at ASC LIMIT 1"
        )
        if not row:
            return False
        video_id = row["id"]
        script = row["script"] or ""
        chosen_topic = row["chosen_topic"]
        if isinstance(chosen_topic, str):
            chosen_topic = _json.loads(chosen_topic)
        topic_title = (chosen_topic or {}).get("title", "") if isinstance(chosen_topic, dict) else ""

        # Atomic claim
        updated = await conn.fetchval(
            "UPDATE ah_videos SET audio_url='tts_submitting', updated_at=NOW() "
            "WHERE id=$1 AND (audio_url IS NULL OR audio_url='tts_submitting') RETURNING id",
            video_id,
        )
        if not updated:
            return False
    finally:
        await conn.close()

    try:
        import openai as _openai  # type: ignore
        openai_key = json.loads(DB_CONFIG_PATH.read_text())  if DB_CONFIG_PATH.exists() else {}
        api_key = os.getenv("OPENAI_API_KEY") or openai_key.get("OPENAI_API_KEY", "")
        client = _openai.AsyncOpenAI(api_key=api_key)

        def split_chunks(text: str, max_chars: int = 4000) -> list[str]:
            if len(text) <= max_chars:
                return [text]
            chunks: list[str] = []
            current = ""
            for para in text.split("\n\n"):
                candidate = f"{current}\n\n{para}" if current else para
                if current and len(candidate) > max_chars:
                    chunks.append(current.strip())
                    current = para
                else:
                    current = candidate
            if current.strip():
                chunks.append(current.strip())
            return chunks or [text[:max_chars]]

        chunks = split_chunks(script)
        logger.info("AH TTS video #%d: %d chunks, script=%d chars", video_id, len(chunks), len(script))

        mp3_parts: list[bytes] = []
        for i, chunk in enumerate(chunks):
            resp = await client.audio.speech.create(model="tts-1", voice="onyx", input=chunk, response_format="mp3")
            mp3_parts.append(resp.read())
            logger.info("AH TTS video #%d chunk %d/%d done", video_id, i + 1, len(chunks))

        audio_bytes = b"".join(mp3_parts)
        logger.info("AH TTS video #%d audio ready (%dKB), transcribing...", video_id, len(audio_bytes) // 1024)

        import io
        audio_file = io.BytesIO(audio_bytes)
        audio_file.name = "audio.mp3"
        transcription = await client.audio.transcriptions.create(
            model="whisper-1", file=audio_file,  # type: ignore[arg-type]
            response_format="verbose_json", timestamp_granularities=["segment"],
        )
        raw = transcription if isinstance(transcription, dict) else transcription.model_dump()
        segments = raw.get("segments") or []

        def fmt(s: float) -> str:
            m, sec = divmod(int(s), 60)
            return f"{m:02d}:{sec:02d}"

        if segments:
            lines = [f"[{fmt(seg['start'])}] {seg['text'].strip()}" for seg in segments]
            whisper_transcript = "\n".join(lines)
            # Keep S3 prompt under ~15000 chars: sample every-other segment if too long
            MAX_TRANSCRIPT_CHARS = 12000
            if len(whisper_transcript) > MAX_TRANSCRIPT_CHARS:
                sampled = lines[::2]
                whisper_transcript = "\n".join(sampled)
                logger.info("AH TTS video #%d transcript sampled: %d→%d chars", video_id, len("\n".join(lines)), len(whisper_transcript))
        else:
            whisper_transcript = raw.get("text", "")

        logger.info("AH TTS video #%d transcript ready (%d chars)", video_id, len(whisper_transcript))

        # Save results and advance to S3
        conn2 = await asyncpg.connect(_sanitize_dsn(dsn), timeout=30)
        try:
            await conn2.execute(
                "UPDATE ah_videos SET audio_url='openai:tts_done', whisper_transcript=$2, "
                "status='s3_pending', updated_at=NOW() WHERE id=$1",
                video_id, whisper_transcript,
            )
            # Fetch active S3 prompt
            s3_row = await conn2.fetchrow(
                "SELECT template FROM ah_prompt_versions WHERE prompt_key='S3' AND is_active=true LIMIT 1"
            )
            prompt_text = (s3_row["template"] if s3_row else "").replace("[TIMESTAMPED_SCRIPT]", whisper_transcript).replace("[TOPIC_TITLE]", topic_title)
            callback_url = f"{web2_url.rstrip('/')}/api/cron/process-jobs" if web2_url else ""
            await conn2.execute(
                "INSERT INTO ah_jobs (video_id, stage, status, prompt_text, metadata, created_at) "
                "VALUES ($1, 'S3', 'pending', $2, $3, NOW())",
                video_id, prompt_text,
                _json.dumps({"web_callback_url": callback_url}) if callback_url else "{}",
            )
            logger.info("AH TTS video #%d → S3 job enqueued", video_id)
        finally:
            await conn2.close()

        # Trigger chain cycle so S3 gets picked up immediately
        if web2_url and web2_secret:
            await _hit_url(f"{web2_url.rstrip('/')}/api/cron/process-jobs", web2_secret)

        return True

    except Exception as exc:
        logger.exception("AH TTS video #%d failed: %s", video_id, exc)
        conn3 = await asyncpg.connect(_sanitize_dsn(dsn), timeout=30)
        try:
            await conn3.execute(
                "UPDATE ah_videos SET audio_url=NULL, status='needs_attention', updated_at=NOW() WHERE id=$1",
                video_id,
            )
        finally:
            await conn3.close()
        return False


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
TERMINAL_VIDEO_STATUSES = ("ready_to_publish", "needs_attention")   # web/ pipeline
AH_TERMINAL_VIDEO_STATUSES = ("ready", "needs_attention")           # ah pipeline


async def fetch_video_status(dsn: str, video_id: int) -> str | None:
    conn = await asyncpg.connect(dsn)
    try:
        return await conn.fetchval("SELECT status FROM videos WHERE id = $1", video_id)
    finally:
        await conn.close()


async def fetch_ah_video_status(dsn: str, video_id: int) -> str | None:
    conn = await asyncpg.connect(dsn)
    try:
        return await conn.fetchval("SELECT status FROM ah_videos WHERE id = $1", video_id)
    finally:
        await conn.close()


def _ah_conversation_key(video_id: int) -> str:
    return f"ah_conversation_url:{video_id}"


def _is_chatgpt_conversation_url(url: str) -> bool:
    return url.startswith("https://chatgpt.com/c/")


async def fetch_ah_conversation_url(dsn: str, video_id: int) -> str | None:
    conn = await asyncpg.connect(dsn)
    try:
        value = await conn.fetchval(
            "SELECT value FROM ah_channel_config WHERE key = $1",
            _ah_conversation_key(video_id),
        )
        if isinstance(value, str) and _is_chatgpt_conversation_url(value):
            return value
        return None
    finally:
        await conn.close()


async def save_ah_conversation_url(dsn: str, video_id: int, url: str) -> None:
    if not _is_chatgpt_conversation_url(url):
        return

    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(
            """
            INSERT INTO ah_channel_config (key, value, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
            """,
            _ah_conversation_key(video_id),
            url,
        )
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
        self.topic_page = None          # P1 reservoir (web/ pipeline)
        self.ah_topic_page = None       # S1 reservoir (ah pipeline)
        self.video_pages: dict[int | tuple, object] = {}
        # ah_videos use ("ah", video_id) tuple keys to avoid int-key collisions

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

    async def _get_ah_video_page(self, dsn: str, video_id: int):
        key = ("ah", video_id)
        page = self.video_pages.get(key)
        if page is None or not await _page_alive(page):
            if page is not None:
                logger.warning("AH tab for video #%s is dead — reopening...", video_id)
                try:
                    await page.close()
                except Exception:
                    pass

            saved_url = await fetch_ah_conversation_url(dsn, video_id)
            logger.info("Opening dedicated AH tab for video #%s%s...", video_id, " from saved conversation" if saved_url else "")
            page = await self._new_logged_in_page()

            if saved_url:
                try:
                    await page.goto(saved_url, wait_until="domcontentloaded", timeout=60_000)
                    await asyncio.sleep(2)
                    logger.info("Restored AH video #%s ChatGPT conversation: %s", video_id, saved_url)
                except Exception as exc:
                    logger.warning(
                        "Could not restore AH video #%s conversation %s — using fresh chat: %s",
                        video_id,
                        saved_url,
                        exc,
                    )
                    try:
                        await page.goto("https://chatgpt.com", wait_until="domcontentloaded", timeout=60_000)
                    except Exception:
                        pass

            self.video_pages[key] = page
        return page

    async def _get_ah_topic_page(self):
        if self.ah_topic_page is None or not await _page_alive(self.ah_topic_page):
            if self.ah_topic_page is not None:
                logger.warning("AH topic-reservoir tab is dead — reopening...")
                try:
                    await self.ah_topic_page.close()
                except Exception:
                    pass
            logger.info("Opening dedicated 'AH topic reservoir' tab for S1...")
            self.ah_topic_page = await self._new_logged_in_page()
        return self.ah_topic_page

    async def get_page_for(self, job: dict, dsn: str):
        """Routes a claimed job to the right conversation tab.

        web/ pipeline: P1 → shared topic_page; P2..P6 → per-video_id page.
        ah pipeline:   S1 → shared ah_topic_page; S2..S4 → per-("ah",video_id) page.
        """
        is_ah = job.get("_table") == "ah_jobs"

        if is_ah:
            if job["stage"] == "S1":
                return await self._get_ah_topic_page()
            video_id = job.get("video_id")
            if video_id is None:
                logger.warning("AH job id=%s stage=%s has no video_id — using scratch tab", job["id"], job["stage"])
                return await self._new_logged_in_page()
            return await self._get_ah_video_page(dsn, video_id)

        if job["stage"] == "P1":
            return await self._get_topic_page()
        video_id = job.get("video_id")
        if video_id is None:
            logger.warning("Job id=%s stage=%s has no video_id — using a scratch tab", job["id"], job["stage"])
            return await self._new_logged_in_page()
        return await self._get_video_page(video_id)

    async def sweep_terminal_tabs(self, dsn: str) -> None:
        """Close & forget any open per-video tab whose video has reached a
        terminal status, freeing resources without losing context for videos
        still mid-pipeline (including needs_retry loops).

        Keys in video_pages can be:
          int        → web/ pipeline video (queries `videos` table)
          ("ah", id) → ah pipeline video   (queries `ah_videos` table)
        """
        for key, page in list(self.video_pages.items()):
            try:
                if isinstance(key, tuple) and key[0] == "ah":
                    status = await fetch_ah_video_status(dsn, key[1])
                    terminal = AH_TERMINAL_VIDEO_STATUSES
                else:
                    status = await fetch_video_status(dsn, key)
                    terminal = TERMINAL_VIDEO_STATUSES
            except Exception:
                continue
            if status in terminal:
                removed = self.video_pages.pop(key, None)
                if removed is not None:
                    logger.info("Video key=%s reached '%s' — closing its dedicated tab.", key, status)
                    try:
                        await removed.close()
                    except Exception:
                        pass

    async def close_all(self) -> None:
        for _, page in list(self.video_pages.items()):
            try:
                await page.close()
            except Exception:
                pass
        self.video_pages.clear()
        for attr in ("topic_page", "ah_topic_page"):
            page = getattr(self, attr, None)
            if page is not None:
                try:
                    await page.close()
                except Exception:
                    pass
                setattr(self, attr, None)


async def record_heartbeat(dsn: str, status: str) -> None:
    """Write heartbeat to both web/ channel_config and web_2/ ah_channel_config.
    Failures are silently swallowed — a heartbeat miss must never crash the poll loop.
    """
    from auto_yt.services.job_queue import _sanitize_dsn
    try:
        from auto_yt.services.job_queue import _connect
        conn = await _connect(dsn)
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
            await conn.execute(
                """
                INSERT INTO ah_channel_config (key, value, updated_at)
                VALUES ('worker_last_seen', NOW()::text, NOW())
                ON CONFLICT (key) DO UPDATE SET value = NOW()::text, updated_at = NOW()
                """,
            )
        finally:
            await conn.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Heartbeat failed (non-fatal): %s", exc)


async def process_ah_job(page, dsn: str, job: dict, *, web2_secret: str = "") -> None:
    """Same ChatGPT execution flow as process_job, but writes to ah_jobs table
    and fires the per-job callback_url stored in metadata."""
    job_id = job["id"]
    stage = job["stage"]
    prompt_text = job["prompt_text"]
    retry_count = job["retry_count"]
    video_id = job.get("video_id")

    logger.info("Running ah_job id=%s stage=%s (prompt %d chars)", job_id, stage, len(prompt_text))
    try:
        response = await send_prompt(prompt_text, page, timeout_s=PROMPT_TIMEOUT_S)
    except ChatGPTResponseError as exc:
        next_retry = retry_count + 1
        if next_retry <= MAX_TRANSIENT_RETRIES:
            logger.warning(
                "AH job id=%s transient failure (attempt %d/%d) — requeuing: %s",
                job_id, next_retry, MAX_TRANSIENT_RETRIES, exc,
            )
            await retry_transient_ah_job(dsn, job_id, error_message=str(exc), retry_count=next_retry)
        else:
            logger.warning("AH job id=%s exhausted retries — hard-failing: %s", job_id, exc)
            await fail_ah_job(dsn, job_id, error_message=str(exc), retry_count=next_retry)
        return
    except Exception as exc:  # noqa: BLE001
        logger.exception("AH job id=%s unexpected error", job_id)
        await fail_ah_job(dsn, job_id, error_message=f"{exc.__class__.__name__}: {exc}", retry_count=retry_count + 1)
        return

    await complete_ah_job(dsn, job_id, result=response, web2_secret=web2_secret)
    if isinstance(video_id, int):
        await save_ah_conversation_url(dsn, video_id, page.url)


async def process_job(page, dsn: str, job: dict, *, web_url: str = "", dashboard_secret: str = "") -> None:
    job_id = job["id"]
    stage = job["stage"]
    prompt_text = job["prompt_text"]
    retry_count = job["retry_count"]

    logger.info("Running job id=%s stage=%s (prompt %d chars)", job_id, stage, len(prompt_text))
    try:
        response = await send_prompt(prompt_text, page, timeout_s=PROMPT_TIMEOUT_S)
    except ChatGPTResponseError as exc:
        next_retry = retry_count + 1
        if next_retry <= MAX_TRANSIENT_RETRIES:
            logger.warning(
                "Job id=%s transient failure (attempt %d/%d) — requeuing for retry: %s",
                job_id, next_retry, MAX_TRANSIENT_RETRIES, exc,
            )
            await retry_transient_job(dsn, job_id, error_message=str(exc), retry_count=next_retry)
        else:
            logger.warning(
                "Job id=%s exhausted %d transient retries — hard-failing: %s",
                job_id, MAX_TRANSIENT_RETRIES, exc,
            )
            await fail_job(dsn, job_id, error_message=str(exc), retry_count=next_retry)
        return
    except Exception as exc:  # noqa: BLE001 - surface unexpected errors as a failed job, not a crash
        logger.exception("Job id=%s unexpected error", job_id)
        await fail_job(dsn, job_id, error_message=f"{exc.__class__.__name__}: {exc}", retry_count=retry_count + 1)
        return

    await complete_job(dsn, job_id, result=response)
    # Immediately kick the Next.js chain cycle so it consumes this job and
    # creates the next stage — avoids waiting for a manual "Chạy pipeline" press.
    await trigger_chain_cycle(web_url, dashboard_secret)


async def _launch_chromium_context(pw):
    """(Re)launch the persistent Chromium context used for every ChatGPT tab.

    Factored out of `run()` so a dead BrowserContext (the whole browser
    crashed/closed, not just one tab — TargetClosedError surfacing from
    `ctx.new_page()` itself) can be replaced in place, instead of wedging
    every subsequent job in 'running' forever (see git history / e2e test
    that caught this: a crashed context left job stuck with no recovery)."""
    # Remove stale Chromium singleton lock files left by a previous crash.
    # Without this, launch_persistent_context raises ProcessSingleton errors
    # if the prior process was killed without a clean shutdown.
    _profile_dir = gpt_profile_dir("PROFILE_GPT_1")
    for _lock in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        _f = _profile_dir / _lock
        try:
            _f.unlink()
            logger.info("Removed stale lock file: %s", _f)
        except FileNotFoundError:
            pass

    ctx = await pw.chromium.launch_persistent_context(
        str(_profile_dir),
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

    return ctx


async def run() -> None:
    dsn = load_database_url()
    account = load_account()
    web_url, dashboard_secret = load_chain_config()
    web2_url, web2_secret = load_web2_config()

    pw = await async_playwright().start()
    ctx = await _launch_chromium_context(pw)

    tabs = TabManager(ctx, account)

    try:
        await tabs.bootstrap()
        await record_heartbeat(dsn, "running")
        last_web2_chain_tick = 0.0

        logger.info("Worker started — polling every %ds. Press Ctrl+C to stop.", POLL_INTERVAL_S)
        while True:
            job = None
            try:
                job = await claim_next_job(dsn)
                if job is None:
                    # Also poll the Ancient Humans pipeline after the main queue is empty
                    job = await claim_next_ah_job(dsn)

                if job is None:
                    now = asyncio.get_running_loop().time()
                    if now - last_web2_chain_tick >= WEB2_CHAIN_TICK_INTERVAL_S:
                        await trigger_chain_cycle(web2_url, web2_secret)
                        last_web2_chain_tick = now
                    await tabs.sweep_terminal_tabs(dsn)
                    await record_heartbeat(dsn, "running")
                    await asyncio.sleep(POLL_INTERVAL_S)
                    continue

                page = await tabs.get_page_for(job, dsn)
                if job.get("_table") == "ah_jobs":
                    await process_ah_job(page, dsn, job, web2_secret=web2_secret)
                else:
                    await process_job(page, dsn, job, web_url=web_url, dashboard_secret=dashboard_secret)
                await tabs.sweep_terminal_tabs(dsn)
                await record_heartbeat(dsn, "running")
            except (ChatGPTLoginError, ChatGPTResponseError) as exc:
                logger.error("ChatGPT error during poll loop: %s", exc)
                await asyncio.sleep(POLL_INTERVAL_S)
            except asyncpg.PostgresError as exc:
                logger.error("Database error during poll loop: %s", exc)
                await asyncio.sleep(POLL_INTERVAL_S)
            except (TimeoutError, asyncio.TimeoutError, ConnectionRefusedError, OSError) as exc:
                # Transient network/connection hiccup (common when Playwright event loop
                # is busy). Non-fatal — pipeline still advances via Vercel cron.
                logger.warning("DB connection hiccup (non-fatal, retrying): %s", exc)
                await asyncio.sleep(POLL_INTERVAL_S)
            except PlaywrightError as exc:
                # The whole BrowserContext died (not just one tab — _page_alive's
                # per-tab recovery can't help here since ctx.new_page() itself is
                # what's throwing). Without this branch the claimed job was left
                # stuck in 'running' forever (claim_next_job only selects
                # 'pending' rows) while every future job kept hitting the same
                # dead ctx — an e2e test caught this stalling the pipeline with
                # no alert. Requeue the job for a fresh attempt and relaunch
                # Chromium so the next iteration gets a live context.
                logger.exception("Browser context died during poll loop — relaunching Chromium")
                if job is not None:
                    requeue_fn = retry_transient_ah_job if job.get("_table") == "ah_jobs" else retry_transient_job
                    try:
                        await requeue_fn(dsn, job["id"], error_message=str(exc), retry_count=job.get("retry_count", 0) + 1)
                    except Exception:
                        logger.exception("Failed to requeue job id=%s after context death", job.get("id"))
                try:
                    await tabs.close_all()
                except Exception:
                    pass
                try:
                    await ctx.close()
                except Exception:
                    pass
                ctx = await _launch_chromium_context(pw)
                tabs.ctx = ctx
                tabs.topic_page = None
                tabs.ah_topic_page = None
                tabs.video_pages = {}
                try:
                    await tabs.bootstrap()
                except Exception:
                    logger.exception("Failed to re-bootstrap topic tab after context relaunch")
                await asyncio.sleep(POLL_INTERVAL_S)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Unexpected error during poll loop: %s", exc)
                if job is not None:
                    requeue_fn = retry_transient_ah_job if job.get("_table") == "ah_jobs" else retry_transient_job
                    try:
                        await requeue_fn(dsn, job["id"], error_message=str(exc), retry_count=job.get("retry_count", 0) + 1)
                    except Exception:
                        logger.exception("Failed to requeue job id=%s after unexpected error", job.get("id"))
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
