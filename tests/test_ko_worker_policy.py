from pathlib import Path

import asyncio
import inspect
import re

from auto_yt.ko_chatgpt import (
    ALLOWED_EFFORTS,
    FILE_UPLOAD_INPUT_SELECTOR,
    REQUIRED_MODEL,
    KoUploadError,
    RENDERED_MESSAGE_TEXT_SCRIPT,
    _click_send,
    _ui_labels,
    _visible_upload_error,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_ko_worker_requires_exact_model_and_efforts() -> None:
    assert REQUIRED_MODEL == "GPT-5.6 Sol"
    assert ALLOWED_EFFORTS == {"High"}
    assert _ui_labels("Model", REQUIRED_MODEL) == (REQUIRED_MODEL,)


def test_ko_worker_uses_fixed_persistent_profile_and_headed_browser() -> None:
    source = (PROJECT_ROOT / "src/auto_yt/ko_worker.py").read_text(encoding="utf-8")
    assert "launch_persistent_context" in source
    assert "gpt_profile_dir()" in source
    assert "headless=False" in source
    assert "temporary" not in source.lower()


def test_ko_worker_has_no_model_or_effort_fallback() -> None:
    source = (PROJECT_ROOT / "src/auto_yt/ko_chatgpt.py").read_text(encoding="utf-8")
    assert "GPT-5.6 Sol" in source
    assert "Thinking" not in source
    assert "Auto" not in source


def test_ko_worker_supports_source_and_fidelity_high_effort_gates() -> None:
    worker_source = (PROJECT_ROOT / "src/auto_yt/ko_worker.py").read_text(encoding="utf-8")
    queue_source = (PROJECT_ROOT / "src/auto_yt/ko_job_queue.py").read_text(encoding="utf-8")
    assert '{"source_audit", "outline", "fidelity_review"}' in worker_source
    assert "source_audit_pending" in queue_source
    assert "final_review_pending" in queue_source


def test_ko_response_detection_tracks_message_ids_instead_of_only_counts() -> None:
    source = (PROJECT_ROOT / "src/auto_yt/ko_chatgpt.py").read_text(encoding="utf-8")
    assert "data-message-id" in source
    assert "previous_ids" in source
    assert "new_ids" in source


def test_rendered_chatgpt_lists_preserve_number_and_bullet_markers() -> None:
    assert 'querySelectorAll("ol, ul")' in RENDERED_MESSAGE_TEXT_SCRIPT
    assert "start + index" in RENDERED_MESSAGE_TEXT_SCRIPT
    assert '"- "' in RENDERED_MESSAGE_TEXT_SCRIPT


class FakeTextLocator:
    def __init__(self, text: str = "", visible: bool = False) -> None:
        self.text = text
        self.visible = visible

    async def count(self) -> int:
        return 1 if self.text else 0

    def nth(self, _index: int):
        return self

    async def is_visible(self, timeout: int) -> bool:
        assert timeout == 500
        return self.visible

    async def inner_text(self, timeout: int) -> str:
        assert timeout == 1_000
        return self.text


class FakeUploadPage:
    def __init__(self, text: str) -> None:
        self.locator = FakeTextLocator(text=text, visible=bool(text))

    def get_by_text(self, pattern: re.Pattern[str]):
        assert pattern.search(self.locator.text)
        return self.locator


def test_upload_error_toast_is_not_accepted_as_attachment_confirmation() -> None:
    page = FakeUploadPage("Unable to upload source.txt")

    message = asyncio.run(_visible_upload_error(page))

    assert message == "Unable to upload source.txt"
    assert issubclass(KoUploadError, Exception)


def test_upload_confirmation_is_scoped_to_composer_and_waits_for_stability() -> None:
    source = (PROJECT_ROOT / "src/auto_yt/ko_chatgpt.py").read_text(encoding="utf-8")
    assert "composer.get_by_text(file_name" in source
    assert "UPLOAD_SETTLE_S = 5" in source
    assert "raise KoUploadError" in source


def test_txt_upload_never_uses_photo_or_camera_file_inputs() -> None:
    source = (PROJECT_ROOT / "src/auto_yt/ko_chatgpt.py").read_text(encoding="utf-8")
    assert ':not([accept])' in FILE_UPLOAD_INPUT_SELECTOR
    assert '[accept=""]' in FILE_UPLOAD_INPUT_SELECTOR
    assert "file_input.first.set_input_files" in source
    assert "file_input.last.set_input_files" not in source


def test_send_waits_for_visible_composer_button_and_confirms_submission() -> None:
    source = inspect.getsource(_click_send)
    assert "_composer_root" in source
    assert "_visible_locator" in source
    assert "aria-disabled" in source
    assert "_prompt_text" in source
    assert '.press("Enter")' not in source
