#!/usr/bin/env python3
"""Login to ChatGPT, send a prompt, and print the response."""

import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from playwright.async_api import async_playwright
from auto_yt.services.chatgpt_login import login_gpt_auto, ChatGPTLoginError
from auto_yt.services.chat_gpt import send_prompt, ChatGPTResponseError
from auto_yt.paths import gpt_profile_dir
from auto_yt.services.chatgpt_login import restore_session

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ACCOUNT_PATH = Path(__file__).resolve().parents[1] / "data" / "account.json"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "last_response.json"

PROMPT = "List exactly 3 fun facts about cats. Number them 1-3. Keep each fact to one sentence."


async def run():
    data = json.loads(ACCOUNT_PATH.read_text())
    account = data.get("gpt_account1", data)

    pw = await async_playwright().start()
    profile_dir = gpt_profile_dir("PROFILE_GPT_1")
    profile_dir.mkdir(parents=True, exist_ok=True)
    ctx = await pw.chromium.launch_persistent_context(
        str(profile_dir),
        headless=False,
        args=["--disable-blink-features=AutomationControlled"],
        viewport={"width": 1280, "height": 800},
    )
    page = ctx.pages[0] if ctx.pages else await ctx.new_page()
    page.set_default_timeout(60_000)

    try:
        logger.info("=== Step 1: Login ===")
        saved_cookies = account.get("session_cookie", [])
        if saved_cookies:
            logger.info("Trying restore_session with %d cookies...", len(saved_cookies))
            try:
                result = await restore_session(saved_cookies, page)
                logger.info("Session restored as %s", result["user"])
            except ChatGPTLoginError as exc:
                logger.warning("Restore failed (%s), falling back to full login", exc)
                result = await login_gpt_auto(account, page)
                logger.info("Logged in as %s", result["user"])
        else:
            result = await login_gpt_auto(account, page)
            logger.info("Logged in as %s", result["user"])

        await asyncio.sleep(2)

        logger.info("=== Step 2: Send prompt ===")
        logger.info("Prompt: %s", PROMPT)
        response = await send_prompt(PROMPT, page, timeout_s=90)

        logger.info("=== Step 3: Response ===")
        print("\n" + "=" * 60)
        print("GPT RESPONSE:")
        print("=" * 60)
        print(response)
        print("=" * 60 + "\n")

        output = {
            "prompt": PROMPT,
            "response": response,
            "user": result["user"],
        }
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2))
        logger.info("Saved to %s", OUTPUT_PATH)

        return True

    except (ChatGPTLoginError, ChatGPTResponseError) as exc:
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
