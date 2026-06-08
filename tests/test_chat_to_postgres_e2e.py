#!/usr/bin/env python3
"""Ask ChatGPT one question, then save prompt/response to Postgres."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from playwright.async_api import async_playwright

from auto_yt.paths import ACCOUNT_PATH, DATA_DIR, gpt_profile_dir
from auto_yt.services.chat_gpt import ChatGPTResponseError, send_prompt
from auto_yt.services.chatgpt_login import ChatGPTLoginError, login_gpt_auto, restore_session
from auto_yt.services.database import save_response

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DB_CONFIG_PATH = DATA_DIR / "db_config.json"
OUTPUT_PATH = DATA_DIR / "last_response.json"
PROMPT = "Trả lời bằng tiếng Việt trong đúng 2 câu: Vì sao nên tự động hóa lưu kết quả ChatGPT vào Postgres?"


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


async def run() -> bool:
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
        user = result.get("user", {})
        logger.info("Logged in user: %s", user)

        logger.info("Asking GPT: %s", PROMPT)
        response = await send_prompt(PROMPT, page, timeout_s=120)
        logger.info("GPT response: %s", response)

        row_id = await save_response(
            dsn,
            account=user.get("email") or account.get("email", "unknown"),
            prompt=PROMPT,
            response=response,
        )

        output = {
            "row_id": row_id,
            "user": user,
            "prompt": PROMPT,
            "response": response,
        }
        OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
        print("\n✅ SAVED TO POSTGRES")
        print(f"row_id: {row_id}")
        print(f"response: {response}")
        return True

    except (ChatGPTLoginError, ChatGPTResponseError, RuntimeError) as exc:
        logger.error("❌ %s: %s", exc.__class__.__name__, exc)
        return False
    except Exception as exc:
        logger.exception("❌ Unexpected: %s", exc)
        return False
    finally:
        await ctx.close()
        await pw.stop()


if __name__ == "__main__":
    ok = asyncio.run(run())
    sys.exit(0 if ok else 1)
