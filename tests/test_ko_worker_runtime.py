import asyncio
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from auto_yt import ko_worker


def test_prepare_profile_rejects_a_live_chromium_owner(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    lock_path = tmp_path / "SingletonLock"
    lock_path.write_text("live", encoding="utf-8")
    monkeypatch.setattr(ko_worker, "gpt_profile_dir", lambda: tmp_path)
    monkeypatch.setattr(
        ko_worker,
        "_profile_process_commands",
        lambda _profile: ["chrome.exe --user-data-dir=fixed-profile"],
    )

    with pytest.raises(ko_worker.KoProfileLockedError):
        ko_worker.prepare_profile()

    assert lock_path.exists()


def test_prepare_profile_only_removes_confirmed_stale_singleton_files(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        (tmp_path / name).write_text("stale", encoding="utf-8")
    monkeypatch.setattr(ko_worker, "gpt_profile_dir", lambda: tmp_path)
    monkeypatch.setattr(ko_worker, "_profile_process_commands", lambda _profile: [])

    assert ko_worker.prepare_profile() == tmp_path
    assert not any((tmp_path / name).exists() for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"))


def test_transient_retry_preserves_the_current_conversation_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    save_url = AsyncMock()
    monkeypatch.setattr(ko_worker, "save_ko_conversation_url", save_url)
    page = type("Page", (), {"url": "https://chatgpt.com/c/conversation-id"})()

    saved = asyncio.run(ko_worker.persist_current_conversation_url(page, "dsn", 42))

    assert saved is True
    save_url.assert_awaited_once_with("dsn", 42, "https://chatgpt.com/c/conversation-id")
