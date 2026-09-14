"""Opt-in smoke check for the exact Korean worker model and effort controls."""

from __future__ import annotations

import asyncio
import logging

from playwright.async_api import async_playwright

from auto_yt.ko_chatgpt import REQUIRED_MODEL, ensure_exact_model_and_effort
from auto_yt.ko_worker import ensure_logged_in, launch_context, load_account
from auto_yt.paths import DATA_DIR


logger = logging.getLogger(__name__)


async def capture_failure(page) -> None:
    output_dir = DATA_DIR / "ko"
    output_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path = output_dir / "model-selector-smoke.png"
    await page.screenshot(path=str(screenshot_path), full_page=True)
    for selector in ('[role="dialog"]', '[data-state="open"]'):
        locator = page.locator(selector)
        for index in range(await locator.count()):
            item = locator.nth(index)
            try:
                if await item.is_visible(timeout=200):
                    text = " ".join((await item.inner_text(timeout=1_000)).split())
                    if text:
                        logger.error("Visible overlay: %s", text[:1000])
            except Exception:
                continue
    logger.error("Model smoke screenshot: %s", screenshot_path)


async def run() -> None:
    playwright = await async_playwright().start()
    context = None
    try:
        context = await launch_context(playwright)
        page = context.pages[0] if context.pages else await context.new_page()
        page.set_default_timeout(60_000)
        await ensure_logged_in(page, load_account())
        try:
            await ensure_exact_model_and_effort(page, REQUIRED_MODEL, "High")
        except Exception:
            await capture_failure(page)
            raise
    finally:
        if context is not None:
            await context.close()
        await playwright.stop()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
