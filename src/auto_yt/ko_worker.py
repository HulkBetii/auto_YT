"""Dedicated FIFO Playwright worker for the Korean content pipeline."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright

from auto_yt.ko_chatgpt import (
    KoChatGPTError,
    KoModelSelectionError,
    KoResponseError,
    ensure_exact_model_and_effort,
    send_ko_prompt,
    start_clean_chat,
    upload_attachment,
)
from auto_yt.ko_job_queue import (
    claim_next_ko_job,
    complete_ko_job,
    fail_ko_job,
    get_ko_conversation_url,
    record_ko_heartbeat,
    retry_transient_ko_job,
    save_ko_conversation_url,
    trigger_ko_chain,
)
from auto_yt.paths import ACCOUNT_PATH, gpt_profile_dir
from auto_yt.services.chatgpt_login import ChatGPTLoginError, login_gpt_auto, restore_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [ko_worker] %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

POLL_INTERVAL_S = 2
IDLE_CHAIN_INTERVAL_S = 10
MAX_TRANSIENT_RETRIES = 3
CHATGPT_ROOT = "https://chatgpt.com/"


class KoProfileLockedError(RuntimeError):
    """Raised when a live Chromium process owns the required profile."""


def load_settings() -> tuple[str, str, str]:
    dsn = os.getenv("DATABASE_URL", "").strip()
    if not dsn:
        raise RuntimeError("Missing DATABASE_URL for ko_worker.")
    web_url = os.getenv("KO_WEB_URL", "http://127.0.0.1:3003").strip()
    dashboard_secret = os.getenv("DASHBOARD_SECRET", "").strip()
    return dsn, web_url, dashboard_secret


def load_account() -> dict[str, Any]:
    if not ACCOUNT_PATH.is_file():
        return {}
    data = json.loads(ACCOUNT_PATH.read_text(encoding="utf-8"))
    account = data.get("gpt_account1", data)
    return account if isinstance(account, dict) else {}


def _profile_process_commands(profile_dir: Path) -> list[str]:
    needle = str(profile_dir.resolve())
    if os.name == "nt":
        script = (
            "$needle = " + repr(needle) + "; "
            "Get-CimInstance Win32_Process | "
            "Where-Object { $_.Name -match '^(chrome|msedge|chromium).*' -and "
            "$_.CommandLine -like ('*' + $needle + '*') } | "
            "ForEach-Object { $_.CommandLine }"
        )
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return [line for line in result.stdout.splitlines() if line.strip()]
    result = subprocess.run(
        ["ps", "-eo", "command="],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return [
        line
        for line in result.stdout.splitlines()
        if needle in line and any(name in line.lower() for name in ("chrome", "chromium"))
    ]


def prepare_profile() -> Path:
    profile_dir = gpt_profile_dir()
    profile_dir.mkdir(parents=True, exist_ok=True)
    processes = _profile_process_commands(profile_dir)
    if processes:
        raise KoProfileLockedError(
            "The required ChatGPT profile is already used by a live Chromium process."
        )
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        lock_path = profile_dir / name
        try:
            lock_path.unlink()
            logger.info("Removed stale profile lock %s", lock_path)
        except FileNotFoundError:
            continue
    return profile_dir


async def launch_context(playwright):
    prepare_profile()
    return await playwright.chromium.launch_persistent_context(
        str(gpt_profile_dir()),
        headless=False,
        args=["--disable-blink-features=AutomationControlled"],
        viewport={"width": 1280, "height": 800},
    )


async def ensure_logged_in(page, account: dict[str, Any]) -> None:
    await page.goto(CHATGPT_ROOT, wait_until="domcontentloaded", timeout=60_000)
    try:
        await page.locator("#prompt-textarea").first.wait_for(state="visible", timeout=10_000)
        return
    except Exception:
        pass
    cookies = account.get("session_cookie", [])
    if cookies:
        try:
            await restore_session(cookies, page)
            return
        except ChatGPTLoginError:
            logger.warning("Stored ChatGPT session could not be restored.")
    if not account:
        raise ChatGPTLoginError("ChatGPT login is required and data/account.json is unavailable.")
    await login_gpt_auto(account, page)


async def page_is_alive(page) -> bool:
    try:
        if page.is_closed():
            return False
        await page.evaluate("1")
        return True
    except Exception:
        return False


async def wait_for_conversation_url(page, timeout_s: int = 15) -> str:
    deadline = asyncio.get_running_loop().time() + timeout_s
    while asyncio.get_running_loop().time() < deadline:
        if page.url.startswith("https://chatgpt.com/c/"):
            return page.url
        await asyncio.sleep(0.5)
    raise KoChatGPTError("ChatGPT did not expose a persistent conversation URL.")


async def persist_current_conversation_url(page, dsn: str, video_id: int) -> bool:
    try:
        conversation_url = page.url
        if not conversation_url.startswith("https://chatgpt.com/c/"):
            return False
        await save_ko_conversation_url(dsn, video_id, conversation_url)
        return True
    except Exception:
        logger.warning("Could not persist the current conversation URL for video %s", video_id)
        return False


async def prepare_job_page(page, dsn: str, job: dict[str, Any]) -> None:
    saved_url = await get_ko_conversation_url(dsn, job["video_id"])
    requires_existing = job["kind"] in {"section", "fidelity_review"} or job["validation_attempt"] > 0
    if requires_existing and not saved_url:
        raise KoChatGPTError("The video has no saved ChatGPT conversation URL.")
    target_url = saved_url or CHATGPT_ROOT
    await page.goto(target_url, wait_until="domcontentloaded", timeout=60_000)
    await page.locator("#prompt-textarea").first.wait_for(state="visible", timeout=30_000)
    if not saved_url:
        await start_clean_chat(page)


async def process_job(
    page,
    dsn: str,
    web_url: str,
    dashboard_secret: str,
    job: dict[str, Any],
) -> None:
    job_id = job["id"]
    retry_count = job["retry_count"]
    prompt_started = False
    try:
        await prepare_job_page(page, dsn, job)
        await ensure_exact_model_and_effort(page, job["model_label"], job["effort"])
        if job.get("attachment_path"):
            await upload_attachment(page, job["attachment_path"])
            logger.info(
                "KO job %s attachment upload confirmed: %s",
                job_id,
                Path(job["attachment_path"]).name,
            )
        timeout_s = 900 if job["kind"] in {"source_audit", "outline", "fidelity_review"} else 360
        prompt_started = True
        result = await send_ko_prompt(page, job["prompt_text"], timeout_s=timeout_s)
        conversation_url = await wait_for_conversation_url(page)
        await save_ko_conversation_url(dsn, job["video_id"], conversation_url)
        await complete_ko_job(dsn, job_id, result)
    except KoModelSelectionError as exc:
        await fail_ko_job(
            dsn,
            job_id,
            error_message=f"MODEL_OR_EFFORT_UNAVAILABLE: {exc}",
            retry_count=retry_count + 1,
        )
    except (KoResponseError, PlaywrightError, asyncio.TimeoutError) as exc:
        if prompt_started:
            await persist_current_conversation_url(page, dsn, job["video_id"])
        next_retry = retry_count + 1
        logger.warning(
            "KO job %s transient failure %s/%s: %s",
            job_id,
            next_retry,
            MAX_TRANSIENT_RETRIES,
            exc,
        )
        if next_retry <= MAX_TRANSIENT_RETRIES:
            await retry_transient_ko_job(
                dsn,
                job_id,
                error_message=str(exc),
                retry_count=next_retry,
            )
        else:
            await fail_ko_job(
                dsn,
                job_id,
                error_message=str(exc),
                retry_count=next_retry,
            )
    except Exception as exc:  # noqa: BLE001
        logger.exception("KO job %s failed", job_id)
        await fail_ko_job(
            dsn,
            job_id,
            error_message=f"{exc.__class__.__name__}: {exc}",
            retry_count=retry_count + 1,
        )
    finally:
        await trigger_ko_chain(web_url, dashboard_secret)


async def run() -> None:
    dsn, web_url, dashboard_secret = load_settings()
    account = load_account()
    playwright = await async_playwright().start()
    context = None
    page = None
    fatal_state: tuple[str, str, bool] | None = None
    try:
        try:
            context = await launch_context(playwright)
        except KoProfileLockedError as exc:
            await record_ko_heartbeat(
                dsn,
                "profile_locked",
                error=str(exc),
                profile_locked=True,
            )
            raise
        page = context.pages[0] if context.pages else await context.new_page()
        page.set_default_timeout(60_000)
        await ensure_logged_in(page, account)
        await record_ko_heartbeat(dsn, "idle")
        last_chain_tick = 0.0

        while True:
            job = await claim_next_ko_job(dsn)
            if job is not None:
                await record_ko_heartbeat(dsn, "running")
                await process_job(page, dsn, web_url, dashboard_secret, job)
                if not await page_is_alive(page):
                    logger.warning("ChatGPT page or browser context died; relaunching.")
                    try:
                        await context.close()
                    except Exception:
                        pass
                    await asyncio.sleep(2)
                    context = await launch_context(playwright)
                    page = context.pages[0] if context.pages else await context.new_page()
                    page.set_default_timeout(60_000)
                    await ensure_logged_in(page, account)
                await record_ko_heartbeat(dsn, "idle")
                continue

            now = asyncio.get_running_loop().time()
            if now - last_chain_tick >= IDLE_CHAIN_INTERVAL_S:
                await trigger_ko_chain(web_url, dashboard_secret)
                last_chain_tick = now
            await record_ko_heartbeat(dsn, "idle")
            await asyncio.sleep(POLL_INTERVAL_S)
    except KoProfileLockedError as exc:
        fatal_state = ("profile_locked", str(exc), True)
        raise
    except Exception as exc:
        fatal_state = ("error", f"{exc.__class__.__name__}: {exc}", False)
        await record_ko_heartbeat(
            dsn,
            fatal_state[0],
            error=fatal_state[1],
            profile_locked=fatal_state[2],
        )
        raise
    finally:
        if fatal_state is None:
            try:
                await record_ko_heartbeat(dsn, "stopped")
            except Exception:
                logger.exception("Could not record stopped heartbeat")
        if context is not None:
            await context.close()
        await playwright.stop()


def main() -> None:
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        logger.info("KO worker stopped by user.")


if __name__ == "__main__":
    main()
