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

# Model picker (top of composer): a button labeled "Instant"/"Thinking"/etc.
# opens a menu listing "Instant", "Thinking", "Configure...". We always want
# "Thinking" mode for content-generation prompts (better reasoning quality).
MODEL_SWITCHER_SEL = 'button:has-text("Instant"), button:has-text("Thinking"), button:has-text("Auto")'
THINKING_MENU_ITEM_SEL = '[role="menuitem"]:has-text("Thinking"), div[role="menuitemradio"]:has-text("Thinking")'

DEFAULT_REPLY_TIMEOUT_S = 120
POLL_INTERVAL_S = 2
TEXT_STABLE_SAMPLES = 3
TEXT_STABLE_INTERVAL_S = 2
TEXT_SETTLE_TIMEOUT_S = 45
SCRIPT_MIN_CHARS = 6_500
DEFAULT_MIN_RESPONSE_CHARS = 1


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


async def ensure_thinking_mode(page) -> None:
    """Best-effort: switch the ChatGPT model picker to "Thinking" mode.

    The composer shows a small dropdown (currently labeled "Instant", "Auto",
    etc. depending on the last-used mode) that opens a menu with "Instant",
    "Thinking", "Configure...". Content-generation prompts produce noticeably
    better results in Thinking mode, and ChatGPT remembers the last-picked
    mode per session — but we re-assert it on every send so a manual override
    (or a session reset) never silently degrades output quality.

    Deliberately swallows all errors: this is a quality nicety, not a
    correctness requirement, and the picker's selectors are the most likely
    part of the ChatGPT UI to change without notice.
    """
    try:
        switcher = page.locator(MODEL_SWITCHER_SEL).first
        if not await switcher.is_visible(timeout=2_000):
            return

        label = (await switcher.inner_text(timeout=1_000)).strip()
        if "Thinking" in label:
            return  # already in Thinking mode

        await switcher.click()
        await asyncio.sleep(0.4)

        option = page.locator(THINKING_MENU_ITEM_SEL).first
        if await option.count() == 0:
            option = page.get_by_text(re.compile(r"^Thinking$")).first
        await option.click(timeout=3_000)
        await asyncio.sleep(0.3)
        logger.info("Switched ChatGPT composer to Thinking mode")
    except Exception as exc:
        logger.warning("Could not switch to Thinking mode (continuing anyway): %s", exc)


async def _get_last_assistant_text(page) -> str | None:
    """Return inner text of the last assistant message, or None."""
    try:
        locator = page.locator(ASSISTANT_MSG_SEL)
        count = await locator.count()
        if count == 0:
            return None
        last = locator.nth(count - 1)
        text = await last.evaluate("(node) => node.innerText || node.textContent || ''", timeout=5_000)
        return str(text).strip()
    except Exception:
        return None


async def _scroll_last_assistant_into_view(page) -> None:
    """Best-effort scroll so long responses finish rendering before extraction."""
    try:
        locator = page.locator(ASSISTANT_MSG_SEL)
        count = await locator.count()
        if count == 0:
            return
        await locator.nth(count - 1).scroll_into_view_if_needed(timeout=2_000)
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    except Exception:
        return


def _expected_min_response_chars(prompt: str) -> int:
    """Infer a conservative lower bound for prompts that must return long text."""
    normalized = prompt.lower()
    if re.search(r"1[,.]?\s*500\s*[-–]\s*2[,.]?\s*400\s+words", normalized):
        return SCRIPT_MIN_CHARS
    return DEFAULT_MIN_RESPONSE_CHARS


def _stability_key(text: str) -> str:
    """Remove tiny UI timers that can change while the actual answer is stable."""
    return re.sub(r"\bthought for \d+\s*(?:s|sec|seconds)\b", "thought for", text, flags=re.I)


async def _wait_response_text_stable(page, prompt: str, timeout_s: int) -> str:
    """Wait until the last assistant response is non-empty, long enough, and stable."""
    min_chars = _expected_min_response_chars(prompt)
    settle_timeout = min(TEXT_SETTLE_TIMEOUT_S, max(12, timeout_s // 4))
    deadline = asyncio.get_event_loop().time() + settle_timeout
    last_text = ""
    last_key = ""
    stable_samples = 0

    while asyncio.get_event_loop().time() < deadline:
        await _scroll_last_assistant_into_view(page)
        text = await _get_last_assistant_text(page) or ""
        key = _stability_key(text)

        if text and len(text) >= min_chars and key == last_key:
            stable_samples += 1
        else:
            stable_samples = 1 if text and len(text) >= min_chars else 0

        if stable_samples >= TEXT_STABLE_SAMPLES:
            return text

        last_text = text or last_text
        last_key = key
        await asyncio.sleep(TEXT_STABLE_INTERVAL_S)

    if not last_text:
        raise ChatGPTResponseError("Assistant message appeared but text is empty.")

    if len(last_text) < min_chars:
        raise ChatGPTResponseError(
            f"Assistant response looks incomplete: {len(last_text)} chars < expected minimum {min_chars} chars."
        )

    logger.warning("Response text did not fully stabilize within %ss; using latest %d chars", settle_timeout, len(last_text))
    return last_text


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

    await ensure_thinking_mode(page)

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
    text = await _wait_response_text_stable(page, prompt, timeout_s)

    logger.info("Response received (%d chars)", len(text))
    return text
