"""Strict ChatGPT web automation for GPT-5.6 Sol Korean jobs."""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

PROMPT_INPUT_SELECTOR = "#prompt-textarea"
ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]'
STOP_SELECTOR = 'button[data-testid="stop-button"], button[aria-label="Stop generating"]'
SEND_SELECTORS = (
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[aria-label*="Send"]',
)
NEW_CHAT_SELECTOR = '[data-testid="create-new-chat-button"]'
REQUIRED_MODEL = "GPT-5.6 Sol"
ALLOWED_EFFORTS = {"High"}
SEND_READY_TIMEOUT_S = 30
SUBMISSION_CONFIRM_TIMEOUT_S = 15
UPLOAD_TIMEOUT_S = 90
UPLOAD_SETTLE_S = 5
UPLOAD_FAILURE_PATTERN = re.compile(
    r"(?:unable|failed|could not|couldn't)\s+to\s+upload|upload\s+(?:failed|error)",
    re.I,
)
UPLOAD_BUSY_SELECTOR = (
    '[role="progressbar"], [aria-busy="true"], [data-state="loading"], .animate-spin'
)
FILE_UPLOAD_INPUT_SELECTOR = (
    'input[type="file"]:not([accept]), input[type="file"][accept=""], '
    'input[type="file"][accept*=".txt"], input[type="file"][accept*="text/"]'
)
RENDERED_MESSAGE_TEXT_SCRIPT = """
(node) => {
  const clone = node.cloneNode(true);
  for (const list of clone.querySelectorAll("ol, ul")) {
    const ordered = list.tagName === "OL";
    const start = ordered ? Number(list.getAttribute("start") || "1") : 1;
    const items = Array.from(list.children).filter((child) => child.tagName === "LI");
    items.forEach((item, index) => {
      const marker = ordered ? `${start + index}. ` : "- ";
      const firstParagraph = Array.from(item.children).find((child) => child.tagName === "P");
      const target = firstParagraph || item;
      target.insertBefore(document.createTextNode(marker), target.firstChild);
    });
  }
  return clone.innerText || clone.textContent || "";
}
"""


class KoChatGPTError(Exception):
    """Base Korean ChatGPT automation error."""


class KoModelSelectionError(KoChatGPTError):
    """Raised when the exact requested model or effort is unavailable."""


class KoResponseError(KoChatGPTError):
    """Raised when a ChatGPT response cannot be completed or extracted."""


class KoUploadError(KoResponseError):
    """Raised when ChatGPT cannot confirm a completed file upload."""


async def _raise_subscription_failure(page) -> None:
    modal = page.locator('[data-testid="modal-subscription-failure"]').first
    try:
        if await modal.is_visible(timeout=300):
            message = " ".join((await modal.inner_text(timeout=1_000)).split())
            raise KoModelSelectionError(
                f"ChatGPT rejected the requested model or effort: {message or 'subscription failure'}"
            )
    except KoModelSelectionError:
        raise
    except Exception:
        return


async def _visible_locator(locator):
    count = await locator.count()
    for index in range(count - 1, -1, -1):
        item = locator.nth(index)
        try:
            if await item.is_visible(timeout=500):
                return item
        except Exception:
            continue
    return None


async def _visible_upload_error(page) -> str:
    locator = await _visible_locator(page.get_by_text(UPLOAD_FAILURE_PATTERN))
    if locator is None:
        return ""
    try:
        return " ".join((await locator.inner_text(timeout=1_000)).split())
    except Exception:
        return "ChatGPT reported an upload failure."


async def _composer_root(page):
    prompt_input = page.locator(PROMPT_INPUT_SELECTOR).first
    composer = prompt_input.locator("xpath=ancestor::form[1]")
    if await composer.count():
        return composer
    composer = prompt_input.locator(
        "xpath=ancestor::*[@data-type='unified-composer' or @data-testid='composer'][1]"
    )
    if await composer.count():
        return composer
    raise KoUploadError("ChatGPT composer container is unavailable for upload verification.")


async def start_clean_chat(page) -> None:
    new_chat = await _visible_locator(page.locator(NEW_CHAT_SELECTOR))
    if new_chat is not None:
        await new_chat.click(timeout=5_000)
    prompt_input = page.locator(PROMPT_INPUT_SELECTOR).first
    await prompt_input.wait_for(state="visible", timeout=15_000)
    await prompt_input.fill("")


async def _wait_for_attachment_upload(page, file_name: str) -> None:
    composer = await _composer_root(page)
    deadline = asyncio.get_running_loop().time() + UPLOAD_TIMEOUT_S
    ready_since = None

    while asyncio.get_running_loop().time() < deadline:
        upload_error = await _visible_upload_error(page)
        if upload_error:
            raise KoUploadError(f"ChatGPT upload failed for {file_name}: {upload_error}")

        attachment = await _visible_locator(composer.get_by_text(file_name, exact=False))
        busy = await _visible_locator(composer.locator(UPLOAD_BUSY_SELECTOR))
        now = asyncio.get_running_loop().time()
        if attachment is not None and busy is None:
            ready_since = ready_since or now
            if now - ready_since >= UPLOAD_SETTLE_S:
                upload_error = await _visible_upload_error(page)
                if upload_error:
                    raise KoUploadError(
                        f"ChatGPT upload failed for {file_name}: {upload_error}"
                    )
                return
        else:
            ready_since = None
        await asyncio.sleep(0.5)

    raise KoUploadError(
        f"ChatGPT did not confirm a stable upload of {file_name} within "
        f"{UPLOAD_TIMEOUT_S} seconds."
    )


async def _click_text_control(page, label: str) -> None:
    text_locator = await _visible_locator(page.get_by_text(label, exact=True))
    if text_locator is None:
        raise KoModelSelectionError(f"Required ChatGPT control '{label}' is not visible.")
    interactive = text_locator.locator(
        "xpath=ancestor-or-self::*[self::button or @role='menuitem' or "
        "@role='menuitemradio' or @role='option'][1]"
    )
    target = interactive if await interactive.count() else text_locator
    await target.focus(timeout=5_000)
    await target.press("Enter")


def _ui_labels(field: str, target_value: str) -> tuple[str, ...]:
    return (target_value,)


async def _open_text_submenu(page, label: str) -> None:
    text_locator = await _visible_locator(page.get_by_text(label, exact=True))
    if text_locator is None:
        raise KoModelSelectionError(f"Required ChatGPT control '{label}' is not visible.")
    interactive = text_locator.locator(
        "xpath=ancestor-or-self::*[@role='menuitem' or self::button][1]"
    )
    target = interactive if await interactive.count() else text_locator
    await target.focus(timeout=5_000)
    await target.press("ArrowRight")


async def ensure_chat_surface(page) -> None:
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    prompt_input = page.locator(PROMPT_INPUT_SELECTOR).first
    chat_control = None
    deadline = asyncio.get_running_loop().time() + 10
    while chat_control is None and asyncio.get_running_loop().time() < deadline:
        controls = page.locator("button, [role='tab'], [role='radio']")
        for index in range(await controls.count()):
            control = controls.nth(index)
            try:
                if await control.is_visible(timeout=200):
                    label = " ".join((await control.inner_text(timeout=500)).split())
                    if label == "Chat":
                        chat_control = control
                        break
            except Exception:
                continue
        if chat_control is None:
            await asyncio.sleep(0.5)
    if chat_control is not None:
        await chat_control.click(timeout=5_000)
        await asyncio.sleep(1)
    try:
        await prompt_input.wait_for(state="visible", timeout=15_000)
    except Exception as exc:
        raise KoModelSelectionError("ChatGPT Chat composer is unavailable.") from exc


async def _open_model_controls(page) -> None:
    await _raise_subscription_failure(page)
    buttons = page.locator("button")
    candidates = []
    for index in range(await buttons.count()):
        button = buttons.nth(index)
        try:
            if not await button.is_visible(timeout=200):
                continue
            label = (await button.inner_text(timeout=500)).strip()
            if any(token in label for token in ("Instant", "Light", "Medium", "High", "GPT-5.6", "5.6 Sol")):
                candidates.append(button)
        except Exception:
            continue
    if not candidates:
        raise KoModelSelectionError("ChatGPT model/effort control was not found near the composer.")
    await candidates[-1].click(timeout=5_000)
    await asyncio.sleep(0.4)
    advanced = await _visible_locator(page.get_by_text("Advanced", exact=True))
    if advanced is not None:
        interactive = advanced.locator(
            "xpath=ancestor-or-self::*[self::button or @role='menuitem'][1]"
        )
        target = interactive if await interactive.count() else advanced
        expanded = (await target.get_attribute("aria-expanded")) == "true"
        opened = (await target.get_attribute("data-state")) == "open"
        if not expanded and not opened:
            await target.focus(timeout=5_000)
            await target.press("Enter")
        await asyncio.sleep(0.5)


async def _read_setting_row(page, label: str) -> str:
    text_locator = await _visible_locator(page.get_by_text(label, exact=True))
    if text_locator is None:
        return ""
    row = text_locator.locator(
        "xpath=ancestor-or-self::*[self::button or @role='menuitem' or "
        "@role='menuitemradio'][1]"
    )
    target = row if await row.count() else text_locator.locator("xpath=..")
    try:
        return (await target.inner_text(timeout=1_000)).strip()
    except Exception:
        return ""


async def _select_setting(page, field: str, target_value: str) -> None:
    await _open_model_controls(page)
    row_text = await _read_setting_row(page, field)
    labels = _ui_labels(field, target_value)
    if not any(label in row_text for label in labels):
        await _open_text_submenu(page, field)
        await asyncio.sleep(0.5)
        for label in labels:
            if await _visible_locator(page.get_by_text(label, exact=True)) is not None:
                await _click_text_control(page, label)
                break
        else:
            raise KoModelSelectionError(
                f"Required {field.lower()} '{target_value}' is unavailable in ChatGPT Chat."
            )
        await asyncio.sleep(0.4)
        await _raise_subscription_failure(page)
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")


async def _has_selected_button(page, target: str) -> bool:
    buttons = page.locator("button")
    for index in range(await buttons.count()):
        button = buttons.nth(index)
        try:
            if await button.is_visible(timeout=200):
                label = " ".join((await button.inner_text(timeout=500)).split())
                if target in label:
                    return True
        except Exception:
            continue
    return False


async def _verify_setting(page, field: str, target: str) -> bool:
    await _open_model_controls(page)
    row_text = await _read_setting_row(page, field)
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    labels = _ui_labels(field, target)
    if any(label in row_text for label in labels):
        return True
    for label in labels:
        if await _has_selected_button(page, label):
            return True
    return False


async def ensure_exact_model_and_effort(page, model_label: str, effort: str) -> None:
    if model_label != REQUIRED_MODEL:
        raise KoModelSelectionError(
            f"Unsupported model '{model_label}'. Required model is '{REQUIRED_MODEL}'."
        )
    if effort not in ALLOWED_EFFORTS:
        raise KoModelSelectionError(f"Unsupported effort '{effort}'.")

    await ensure_chat_surface(page)
    await _select_setting(page, "Model", model_label)
    await _select_setting(page, "Effort", effort)
    if not await _verify_setting(page, "Model", model_label):
        raise KoModelSelectionError(f"Could not verify selected model '{model_label}'.")
    if not await _verify_setting(page, "Effort", effort):
        raise KoModelSelectionError(f"Could not verify selected effort '{effort}'.")


async def upload_attachment(page, attachment_path: str) -> None:
    path = Path(attachment_path).resolve()
    if not path.is_file():
        raise KoChatGPTError(f"Attachment does not exist: {path}")

    file_input = page.locator(FILE_UPLOAD_INPUT_SELECTOR)
    if await file_input.count() == 0:
        attach_button = page.locator(
            'button[aria-label*="Attach"], button[aria-label*="Upload"], '
            'button[data-testid*="attach"], button[data-testid*="upload"]'
        ).first
        try:
            await attach_button.click(timeout=3_000)
        except Exception as exc:
            raise KoChatGPTError("ChatGPT attachment control is unavailable.") from exc
        await asyncio.sleep(0.4)
        file_input = page.locator(FILE_UPLOAD_INPUT_SELECTOR)
    if await file_input.count() == 0:
        raise KoChatGPTError("ChatGPT file input is unavailable.")

    await file_input.first.set_input_files(str(path))
    await _wait_for_attachment_upload(page, path.name)


async def _prompt_text(prompt_input) -> str:
    value = await prompt_input.evaluate("node => node.innerText || node.textContent || ''")
    return str(value).strip()


async def _click_send(page) -> None:
    composer = await _composer_root(page)
    prompt_input = page.locator(PROMPT_INPUT_SELECTOR).first
    deadline = asyncio.get_running_loop().time() + SEND_READY_TIMEOUT_S

    while asyncio.get_running_loop().time() < deadline:
        for selector in SEND_SELECTORS:
            button = await _visible_locator(composer.locator(selector))
            if button is None:
                continue
            try:
                aria_disabled = (await button.get_attribute("aria-disabled")) == "true"
                if not aria_disabled and await button.is_enabled():
                    await button.click(timeout=5_000)
                    confirm_deadline = (
                        asyncio.get_running_loop().time() + SUBMISSION_CONFIRM_TIMEOUT_S
                    )
                    while asyncio.get_running_loop().time() < confirm_deadline:
                        if not await _prompt_text(prompt_input):
                            logger.info("ChatGPT prompt submission confirmed.")
                            return
                        await asyncio.sleep(0.25)
                    raise KoResponseError(
                        "ChatGPT send button was clicked but the prompt remained in the composer."
                    )
            except KoResponseError:
                raise
            except Exception:
                continue
        await asyncio.sleep(0.25)

    raise KoResponseError("ChatGPT send button did not become ready.")


async def _assistant_message_ids(page) -> list[str]:
    return await page.locator(ASSISTANT_SELECTOR).evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('data-message-id')).filter(Boolean)"
    )


async def _last_assistant_text(page, message_id: str | None = None) -> str:
    messages = (
        page.locator(f'{ASSISTANT_SELECTOR}[data-message-id="{message_id}"]')
        if message_id
        else page.locator(ASSISTANT_SELECTOR)
    )
    count = await messages.count()
    if count == 0:
        return ""
    text = await messages.nth(count - 1).evaluate(RENDERED_MESSAGE_TEXT_SCRIPT)
    return str(text).strip()


async def send_ko_prompt(page, prompt: str, *, timeout_s: int) -> str:
    if not prompt.strip():
        raise KoResponseError("Prompt is empty.")
    input_element = page.locator(PROMPT_INPUT_SELECTOR).first
    try:
        await input_element.wait_for(state="visible", timeout=15_000)
    except Exception as exc:
        raise KoResponseError("ChatGPT prompt input is unavailable.") from exc

    previous_count = await page.locator(ASSISTANT_SELECTOR).count()
    previous_ids = set(await _assistant_message_ids(page))
    previous_text = await _last_assistant_text(page)
    await input_element.click()
    await input_element.fill(prompt)
    await _click_send(page)

    deadline = asyncio.get_running_loop().time() + timeout_s
    response_message_id = None
    while asyncio.get_running_loop().time() < deadline:
        current_ids = await _assistant_message_ids(page)
        new_ids = [message_id for message_id in current_ids if message_id not in previous_ids]
        if new_ids:
            response_message_id = new_ids[-1]
            break
        current_count = await page.locator(ASSISTANT_SELECTOR).count()
        current_text = await _last_assistant_text(page)
        if current_count > previous_count or (current_text and current_text != previous_text):
            break
        await asyncio.sleep(2)
    else:
        raise KoResponseError(f"No assistant response appeared within {timeout_s} seconds.")

    while asyncio.get_running_loop().time() < deadline:
        if await page.locator(STOP_SELECTOR).count() == 0:
            break
        await asyncio.sleep(2)
    else:
        raise KoResponseError(f"Response was still streaming after {timeout_s} seconds.")

    stable_text = ""
    last_key = ""
    stable_samples = 0
    for _ in range(30):
        text = await _last_assistant_text(page)
        key = re.sub(
            r"\s+",
            " ",
            re.sub(
                r"\bthought for \d+\s*(?:s|sec|seconds)\b",
                "thought for",
                text,
                flags=re.I,
            ),
        ).strip()
        if text and key == last_key:
            stable_samples += 1
        else:
            stable_samples = 1 if text else 0
        stable_text = text
        last_key = key
        if stable_samples >= 3:
            return stable_text
        await asyncio.sleep(2)
    if not stable_text:
        raise KoResponseError("Assistant response is empty.")
    return stable_text
