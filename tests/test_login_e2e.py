#!/usr/bin/env python3
"""
End‑to‑end test of login_gpt_auto() with a real browser.

Usage:
    python3 test_login_e2e.py

Environment variables:
    CHATGPT_EMAIL, CHATGPT_PASSWORD, CHATGPT_TOTP_SECRET  (optional)

If no env vars, loads test_config.json.
"""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Dict, Optional

from playwright.async_api import async_playwright

# Add current directory to Python path for import
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from auto_yt.services.chatgpt_login import login_gpt_auto, restore_session, ChatGPTLoginError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TEST_CONFIG_PATH = Path(__file__).resolve().parents[1] / "data" / "account.json"


def load_test_account() -> Optional[Dict[str, str]]:
    """Load account credentials from env vars or JSON config."""
    email = os.getenv("CHATGPT_EMAIL", "").strip()
    password = os.getenv("CHATGPT_PASSWORD", "").strip()
    totp_secret = os.getenv("CHATGPT_TOTP_SECRET", "").strip()

    if email and password:
        logger.info("Loaded credentials from environment variables")
        return {
            "email": email,
            "password": password,
            "totp_secret": totp_secret if totp_secret else None,
        }

    if TEST_CONFIG_PATH.exists():
        try:
            data = json.loads(TEST_CONFIG_PATH.read_text())
            email = data.get("email", "").strip()
            password = data.get("password", "").strip()
            totp_secret = data.get("totp_secret", "").strip()
            if email and password:
                logger.info("Loaded credentials from %s", TEST_CONFIG_PATH)
                return {
                    "email": email,
                    "password": password,
                    "totp_secret": totp_secret if totp_secret else None,
                }
        except Exception as e:
            logger.warning("Failed to parse config file: %s", e)

    return None  # no credentials found


async def test_login(account: Dict[str, str]) -> bool:
    """Launch browser and attempt to log in."""
    logger.info("Testing with email: %s", account["email"])
    if account.get("totp_secret"):
        logger.info("MFA enabled (TOTP secret provided)")
    else:
        logger.info("MFA disabled")

    playwright = None
    browser = None
    context = None
    page = None

    try:
        playwright = await async_playwright().start()
        # MUST be headless=False to pass Cloudflare challenge
        browser = await playwright.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        )
        page = await context.new_page()
        page.set_default_timeout(60_000)

        logger.info("Calling login_gpt_auto...")
        result = await login_gpt_auto(account, page)

        logger.info("✅ Login succeeded!")
        logger.info("User: %s", json.dumps(result["user"], indent=2))
        logger.info("Cookies captured: %d", len(result["cookies"]))

        # Show key cookie names
        cookie_names = sorted(c.get("name", "") for c in result["cookies"])
        logger.info("Cookie names: %s", ", ".join(cookie_names[:10]) + (" …" if len(cookie_names) > 10 else ""))

        # Quick accessibility check
        try:
            prompt = page.locator('textarea[name="prompt-textarea"]').first
            await prompt.wait_for(state="visible", timeout=10_000)
            logger.info("✅ Prompt textarea accessible")
        except Exception:
            logger.warning("Prompt textarea not visible — UI may have changed")

        # Test session restore
        logger.info("Testing restore_session...")
        context2 = await browser.new_context()
        page2 = await context2.new_page()
        await page2.set_default_timeout(60_000)

        restored = await restore_session(result["cookies"], page2)
        logger.info("✅ Session restore succeeded")
        logger.info("Restored user: %s", json.dumps(restored["user"], indent=2))

        await context2.close()
        return True

    except ChatGPTLoginError as e:
        logger.error("❌ Login error: %s", e)
        logger.error("Type: %s", e.__class__.__name__)
        return False
    except Exception as e:
        logger.exception("❌ Unexpected error: %s", e)
        return False
    finally:
        if page and not page.is_closed():
            await page.close()
        if context:
            await context.close()
        if browser:
            await browser.close()
        if playwright:
            await playwright.stop()


async def test_dry_run() -> bool:
    """Navigate to chatgpt.com and verify page load (no login)."""
    logger.info("=== DRY‑RUN (page load check) ===")

    playwright = None
    browser = None
    page = None

    try:
        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()
        page.set_default_timeout(60_000)

        await page.goto("https://chatgpt.com", wait_until="domcontentloaded")
        await asyncio.sleep(3)

        title = await page.title()
        logger.info("Page title: %s", title)
        if title.lower() in ("just a moment...", "checking your browser"):
            logger.warning("⚠️  Cloudflare challenge detected (expected in headed mode)")
        else:
            logger.info("✅ Page loaded past Cloudflare")

        # Check a few key elements
        selectors = [
            ("Log in button", 'button:has-text("Log in")'),
            ("Chat input", 'textarea[name="prompt-textarea"]'),
            ("Client‑bootstrap script", 'script#client-bootstrap'),
        ]

        for desc, sel in selectors:
            try:
                count = await page.locator(sel).count()
                logger.info("  %s: %s", desc, f"found ({count})" if count else "not found")
            except Exception:
                logger.warning("  %s: error", desc)

        return True

    except Exception as e:
        logger.exception("Dry‑run failed: %s", e)
        return False
    finally:
        if page:
            await page.close()
        if browser:
            await browser.close()
        if playwright:
            await playwright.stop()


def main() -> None:
    """Run either full e2e or dry‑run."""
    account = load_test_account()

    if account and account.get("email") != "YOUR_EMAIL@gmail.com":
        print(f"\n⚠️  REAL CREDENTIALS DETECTED: {account['email']}")
        print("This will launch a real browser and attempt login to ChatGPT.")
        response = input("Continue? (yes/no): ").strip().lower()
        if response in ("yes", "y"):
            success = asyncio.run(test_login(account))
        else:
            print("Switching to dry‑run.")
            success = asyncio.run(test_dry_run())
    else:
        print("No valid test credentials found. Running dry‑run.")
        success = asyncio.run(test_dry_run())

    if success:
        logger.info("🏁 Test completed successfully")
    else:
        logger.error("🏁 Test failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
