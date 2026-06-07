"""Send a prompt to ChatGPT via Playwright and extract the response."""

from __future__ import annotations

import asyncio
import logging
import re

logger = logging.getLogger(__name__)

# --- Constants -----------------------------------------------------------

PROMPT_INPUT_SEL = "#prompt-textarea"
SEND_BUTTON_SELS = (
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[aria-label*="Send"]',
)
ASSISTANT_MSG_SEL = '[data-message-author-role="assistant"]'
STOP_BUTTON_SEL  = 'button[data-testid="stop-button"], button[aria-label="Stop generating"]'

DEFAULT_REPLY_TIMEOUT_S = 120
POLL_INTERVAL_S = 2


class ChatGPTResponseError(Exception):
    """Raised when response extraction fails."""


# --- Helpers -------------------------------------------------------------

async def _wait_streaming_done(page, timeout_s: int = DEFAULT_REPLY_TIMEOUT_S) -> None:
    """Wait until the stop/streaming button disappears (GPT done generating)."""
    deadline = asyncio.get_event_loop().time() + timeout_s
    while asyncio.get_event_loop().time() < deadline:
        try:
            if await page.locator(STOP_BUTTON_SEL).count() == 0:
                return
        except Exception:
            return
        await asyncio.sleep(POLL_INTERVAL_S)
    raise ChatGPTResponseError(f"Response still streaming after {timeout_s}s timeout.")


async def _click_send(page) -> None:
    """Find and click the send button, fallback to Enter key."""
    for sel in SEND_BUTTON_SELS:
        try:
            btn = page.locator(sel).first
            if await btn.is_visible(timeout=2_000) and await btn.is_enabled():
                await btn.click()
                return
        except Exception:
            continue
    logger.warning("No send button found, pressing Enter as fallback")
    await page.locator(PROMPT_INPUT_SEL).first.press("Enter")


async def _get_last_assistant_text(page) -> str | None:
    """Return inner text of the last assistant message, or None."""
    try:
        locator = page.locator(ASSISTANT_MSG_SEL)
        count = await locator.count()
        if count == 0:
            return None
        last = locator.nth(count - 1)
        return (await last.inner_text(timeout=5_000)).strip()
    except Exception:
        return None


# --- Public API ----------------------------------------------------------

async def send_prompt(
    prompt: str,
    page,
    *,
    timeout_s: int = DEFAULT_REPLY_TIMEOUT_S,
) -> str:
    """
    Type a prompt into ChatGPT and return the full assistant response text.

    Parameters
    ----------
    prompt : str
        The message to send.
    page : playwright.async_api.Page
        An already-logged-in ChatGPT page at chatgpt.com.
    timeout_s : int
        Max seconds to wait for GPT to finish generating.

    Returns
    -------
    str — The full response text from ChatGPT.

    Raises
    ------
    ChatGPTResponseError — if prompt could not be sent or response not received.
    """
    if not prompt.strip():
        raise ChatGPTResponseError("Prompt is empty.")

    prev_count = await page.locator(ASSISTANT_MSG_SEL).count()

    logger.info("Typing prompt (%d chars)", len(prompt))
    input_el = page.locator(PROMPT_INPUT_SEL).first
    try:
        await input_el.wait_for(state="visible", timeout=10_000)
    except Exception as exc:
        raise ChatGPTResponseError(f"Chat input not found: {exc}") from exc

    await input_el.click()
    await asyncio.sleep(0.2)
    await input_el.fill(prompt)
    await asyncio.sleep(0.3)

    logger.info("Clicking send")
    await _click_send(page)
    await asyncio.sleep(1)

    # Wait for a NEW assistant message to appear
    logger.info("Waiting for assistant response...")
    deadline = asyncio.get_event_loop().time() + timeout_s
    while asyncio.get_event_loop().time() < deadline:
        current_count = await page.locator(ASSISTANT_MSG_SEL).count()
        if current_count > prev_count:
            break
        await asyncio.sleep(POLL_INTERVAL_S)
    else:
        raise ChatGPTResponseError(f"No new assistant message appeared within {timeout_s}s.")

    # Wait for streaming to finish
    await _wait_streaming_done(page, timeout_s)
    await asyncio.sleep(1)

    text = await _get_last_assistant_text(page)
    if not text:
        raise ChatGPTResponseError("Assistant message appeared but text is empty.")

    logger.info("Response received (%d chars)", len(text))
    return text
