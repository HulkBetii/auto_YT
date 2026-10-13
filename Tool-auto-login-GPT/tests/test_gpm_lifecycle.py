import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from auto_yt.services import database as db
from auto_yt.services.channel_scanner_service import (
    _profile_operation_counts,
    _profile_operation_guard,
    is_profile_busy_or_queued,
)
from auto_yt.services.gpm_service import gpm_browser_session


class TestGpmLifecycle(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_db_path = Path(self.temp_dir.name) / "test-gpm.db"
        self.db_patch = patch.object(db, "DB_PATH", self.temp_db_path)
        self.db_patch.start()
        db.init_db()

        with _profile_operation_guard:
            _profile_operation_counts.clear()

    def tearDown(self):
        self.db_patch.stop()
        self.temp_dir.cleanup()
        with _profile_operation_guard:
            _profile_operation_counts.clear()

    def test_is_profile_busy_when_lock_contended(self):
        clean_id = "test-prof-1"
        with _profile_operation_guard:
            _profile_operation_counts[clean_id] = 2

        is_busy, reason = is_profile_busy_or_queued(clean_id)
        self.assertTrue(is_busy)
        self.assertIn("đang chờ", reason)

    def test_is_profile_busy_when_job_queued(self):
        clean_id = "test-prof-2"
        channel = db.upsert_youtube_channel(
            channel_id="UC_TEST_QUEUED",
            title="Test Queued Channel",
            gpm_profile_id=clean_id,
        )

        job = db.create_system_job(
            "job-test-queued-1",
            "comment_publish",
            "Publish comment",
            payload={"channel_id": channel["id"]},
        )
        # Ensure status is queued
        db.update_system_job(job["id"], status="queued")

        is_busy, reason = is_profile_busy_or_queued(clean_id)
        self.assertTrue(is_busy)
        self.assertIn("queued", reason)

    def test_is_profile_idle_when_no_jobs_or_contention(self):
        clean_id = "test-prof-3"
        with _profile_operation_guard:
            _profile_operation_counts[clean_id] = 1

        is_busy, reason = is_profile_busy_or_queued(clean_id)
        self.assertFalse(is_busy)
        self.assertEqual(reason, "")

    def test_gpm_browser_session_skips_stop_when_busy(self):
        clean_id = "test-prof-4"

        fake_launch = {
            "already_running": False,
            "remote_debugging_port": 12345,
            "websocket_debugging_url": "ws://127.0.0.1:12345",
        }

        mock_context = MagicMock()
        mock_context.pages = []
        mock_browser = MagicMock()
        mock_browser.contexts = [mock_context]

        mock_playwright = AsyncMock()
        mock_playwright.chromium.connect_over_cdp = AsyncMock(return_value=mock_browser)
        mock_playwright.stop = AsyncMock()

        mock_cm = AsyncMock()
        mock_cm.start = AsyncMock(return_value=mock_playwright)

        async def run_session():
            with patch("auto_yt.services.gpm_service.start_gpm_profile", return_value=fake_launch), \
                 patch("auto_yt.services.gpm_service.wait_for_cdp_readiness", new_callable=AsyncMock, return_value="ws://127.0.0.1:12345"), \
                 patch("playwright.async_api.async_playwright", return_value=mock_cm), \
                 patch("auto_yt.services.gpm_service.stop_gpm_profile") as mock_stop, \
                 patch("auto_yt.services.channel_scanner_service.is_profile_busy_or_queued", return_value=(True, "Lock contended")):
                async with gpm_browser_session(clean_id) as (ctx, browser):
                    pass
                mock_stop.assert_not_called()

        asyncio.run(run_session())

    def test_gpm_browser_session_stops_when_not_busy(self):
        clean_id = "test-prof-5"

        fake_launch = {
            "already_running": False,
            "remote_debugging_port": 12345,
            "websocket_debugging_url": "ws://127.0.0.1:12345",
        }

        mock_context = MagicMock()
        mock_context.pages = []
        mock_browser = MagicMock()
        mock_browser.contexts = [mock_context]

        mock_playwright = AsyncMock()
        mock_playwright.chromium.connect_over_cdp = AsyncMock(return_value=mock_browser)
        mock_playwright.stop = AsyncMock()

        mock_cm = AsyncMock()
        mock_cm.start = AsyncMock(return_value=mock_playwright)

        async def run_session():
            with patch("auto_yt.services.gpm_service.start_gpm_profile", return_value=fake_launch), \
                 patch("auto_yt.services.gpm_service.wait_for_cdp_readiness", new_callable=AsyncMock, return_value="ws://127.0.0.1:12345"), \
                 patch("playwright.async_api.async_playwright", return_value=mock_cm), \
                 patch("auto_yt.services.gpm_service.stop_gpm_profile") as mock_stop, \
                 patch("auto_yt.services.channel_scanner_service.is_profile_busy_or_queued", return_value=(False, "")):
                async with gpm_browser_session(clean_id) as (ctx, browser):
                    pass
                mock_stop.assert_called_once_with(clean_id, api_url=None)

        asyncio.run(run_session())
