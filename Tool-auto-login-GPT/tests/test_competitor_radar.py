import datetime as dt
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from auto_yt import main
from auto_yt.services import competitor_radar
from auto_yt.services import database as db


class TestCompetitorRadarPersistence(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.temp_dir.name) / "radar.db"
        self.db_patch = patch.object(db, "DB_PATH", self.db_path)
        self.db_patch.start()
        db.init_db()
        now = db.utc_now()
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """
                INSERT INTO youtube_channels (channel_id, title, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                ("UC_TARGET_RADAR_0000000001", "Target", now, now),
            )
            self.target_channel_id = int(cursor.lastrowid)
        self.competitor = db.upsert_competitor_channel(
            channel_id="UC_COMPETITOR_000000001",
            canonical_url="https://www.youtube.com/channel/UC_COMPETITOR_000000001",
            title="Competitor",
        )

    def tearDown(self):
        self.db_patch.stop()
        self.temp_dir.cleanup()

    def _rule(self, prompt_version: str) -> dict:
        return db.create_competitor_watch_rule(
            competitor_channel_id=self.competitor["id"],
            prompt_version=prompt_version,
            target_youtube_channel_id=self.target_channel_id,
            status="enabled",
            publication_mode="schedule",
        )

    def test_migration_creates_all_radar_casting_and_qc_tables(self):
        with sqlite3.connect(self.db_path) as conn:
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                ).fetchall()
            }
        self.assertTrue(
            {
                "competitor_channels",
                "competitor_watch_rules",
                "competitor_source_videos",
                "competitor_dispatches",
                "video_cast_assignments",
                "speaker_voice_registry",
                "video_quality_reviews",
            }.issubset(tables)
        )

    def test_shared_competitor_dispatches_once_for_each_prompt(self):
        first_rule = self._rule("prompt-alpha")
        second_rule = self._rule("prompt-beta")
        source, created = db.upsert_competitor_source_video(
            competitor_channel_id=self.competitor["id"],
            youtube_video_id="new-video-1",
            url="https://www.youtube.com/watch?v=new-video-1",
            title="New upload",
            published_at="2026-10-17T08:00:00+00:00",
            is_baseline=False,
        )
        self.assertTrue(created)

        dispatch_a, created_a = db.reserve_competitor_dispatch(
            source_video_id=source["id"],
            watch_rule_id=first_rule["id"],
            prompt_version="prompt-alpha",
        )
        dispatch_b, created_b = db.reserve_competitor_dispatch(
            source_video_id=source["id"],
            watch_rule_id=second_rule["id"],
            prompt_version="prompt-beta",
        )
        duplicate_a, duplicate_created = db.reserve_competitor_dispatch(
            source_video_id=source["id"],
            watch_rule_id=first_rule["id"],
            prompt_version="prompt-alpha",
        )

        self.assertTrue(created_a)
        self.assertTrue(created_b)
        self.assertNotEqual(dispatch_a["id"], dispatch_b["id"])
        self.assertFalse(duplicate_created)
        self.assertEqual(duplicate_a["id"], dispatch_a["id"])
        self.assertEqual(len(db.list_competitor_dispatches()), 2)

    def test_source_video_upsert_is_idempotent(self):
        payload = {
            "competitor_channel_id": self.competitor["id"],
            "youtube_video_id": "baseline-video",
            "url": "https://www.youtube.com/watch?v=baseline-video",
            "title": "Baseline",
            "published_at": "2026-10-16T08:00:00+00:00",
            "is_baseline": True,
        }
        first, first_created = db.upsert_competitor_source_video(**payload)
        second, second_created = db.upsert_competitor_source_video(**payload)
        self.assertTrue(first_created)
        self.assertFalse(second_created)
        self.assertEqual(first["id"], second["id"])

    def test_failed_dispatch_is_retried_after_last_success_boundary(self):
        rule = self._rule("prompt-retry")
        db.update_competitor_watch_rule(
            rule["id"],
            baseline_complete=True,
            last_success_at="2026-10-17T09:00:00+00:00",
        )
        source, _created = db.upsert_competitor_source_video(
            competitor_channel_id=self.competitor["id"],
            youtube_video_id="retry-video",
            url="https://www.youtube.com/watch?v=retry-video",
            title="Retry upload",
            published_at="2026-10-17T08:00:00+00:00",
            is_baseline=False,
        )
        dispatch, _reserved = db.reserve_competitor_dispatch(
            source_video_id=source["id"],
            watch_rule_id=rule["id"],
            prompt_version="prompt-retry",
        )
        db.update_competitor_dispatch(dispatch["id"], status="error", error="temporary")
        job = db.create_system_job(
            job_id="scan-retry",
            job_type="competitor_scan",
            title="Retry scan",
            payload={"rule_id": rule["id"], "automatic": True},
            prompt_version="prompt-retry",
        )
        feed = [
            {
                "youtube_video_id": "retry-video",
                "url": "https://www.youtube.com/watch?v=retry-video",
                "title": "Retry upload",
                "published_at": "2026-10-17T08:00:00+00:00",
                "updated_at": "2026-10-17T08:00:00+00:00",
            }
        ]
        with patch.object(
            main.db,
            "get_youtube_channel",
            return_value={
                "id": self.target_channel_id,
                "gpm_profile_id": "profile-1",
                "gpm_proxy_info": "http://127.0.0.1:8080",
            },
        ), patch.object(
            main, "_competitor_rule_preflight"
        ), patch.object(
            main.competitor_radar, "fetch_channel_feed", return_value=feed
        ), patch.object(
            main.competitor_radar,
            "next_scan_at",
            return_value="2026-10-17T09:20:00+00:00",
        ), patch.object(
            main,
            "_enqueue_video_request",
            return_value={"status": "queued", "job_id": "video-retry"},
        ) as enqueue:
            main._execute_competitor_scan_job(job)

        enqueue.assert_called_once()
        retried = db.get_competitor_dispatch(source["id"], "prompt-retry")
        self.assertEqual(retried["status"], "queued")
        self.assertEqual(retried["system_job_id"], "video-retry")

    def test_deleting_rule_cascades_its_dispatches(self):
        rule = self._rule("prompt-delete")
        source, _created = db.upsert_competitor_source_video(
            competitor_channel_id=self.competitor["id"],
            youtube_video_id="delete-video",
            url="https://www.youtube.com/watch?v=delete-video",
            title="Delete upload",
            published_at="2026-10-17T08:00:00+00:00",
            is_baseline=False,
        )
        db.reserve_competitor_dispatch(
            source_video_id=source["id"],
            watch_rule_id=rule["id"],
            prompt_version="prompt-delete",
        )

        self.assertTrue(db.delete_competitor_watch_rule(rule["id"]))
        self.assertIsNone(db.get_competitor_dispatch(source["id"], "prompt-delete"))


class TestCompetitorRadarScheduling(unittest.TestCase):
    def test_scan_cadence_for_cold_predicted_and_off_window(self):
        now = dt.datetime(2026, 10, 17, 12, 0, tzinfo=dt.timezone.utc)
        self.assertEqual(
            competitor_radar.next_scan_delay_seconds(
                published_times=[now.isoformat()] * 4,
                now=now,
            ),
            5 * 60,
        )
        weekly_samples = [now - dt.timedelta(days=7 * index) for index in range(5)]
        self.assertEqual(
            competitor_radar.next_scan_delay_seconds(
                published_times=weekly_samples,
                now=now,
            ),
            2 * 60,
        )
        off_window_samples = [
            now.replace(hour=3) - dt.timedelta(days=7 * index) for index in range(5)
        ]
        self.assertEqual(
            competitor_radar.next_scan_delay_seconds(
                published_times=off_window_samples,
                now=now,
            ),
            20 * 60,
        )

    def test_manual_window_overrides_learned_schedule(self):
        now = dt.datetime(2026, 10, 17, 12, 0, tzinfo=dt.timezone.utc)
        windows = [{"days": [5], "start": "11:30", "end": "12:30"}]
        self.assertEqual(
            competitor_radar.next_scan_delay_seconds(
                published_times=[],
                now=now,
                window_mode="manual",
                manual_windows=windows,
                timezone_name="UTC",
            ),
            2 * 60,
        )

    def test_manual_window_can_cross_midnight(self):
        tuesday_after_midnight = dt.datetime(
            2026, 10, 20, 0, 30, tzinfo=dt.timezone.utc
        )
        self.assertTrue(
            competitor_radar.is_in_manual_window(
                tuesday_after_midnight,
                [{"days": [0], "start": "23:00", "end": "01:00"}],
                timezone_name="UTC",
            )
        )

    @patch.object(competitor_radar, "create_proxy_opener")
    def test_feed_fetch_fails_closed_before_network_without_proxy(self, opener):
        with self.assertRaises(competitor_radar.CompetitorRadarError):
            competitor_radar.fetch_channel_feed("UC_COMPETITOR_000000001", "")
        opener.assert_not_called()

    def test_feed_parser_keeps_only_baseline_count(self):
        entries = "".join(
            f"""
            <entry>
              <yt:videoId>video-{index}</yt:videoId>
              <title>Video {index}</title>
              <published>2026-10-17T{index % 10:02d}:00:00+00:00</published>
              <link rel="alternate" href="https://www.youtube.com/watch?v=video-{index}" />
            </entry>
            """
            for index in range(18)
        )
        xml = (
            '<feed xmlns="http://www.w3.org/2005/Atom" '
            'xmlns:yt="http://www.youtube.com/xml/schemas/2015">'
            + entries
            + "</feed>"
        ).encode()
        videos = competitor_radar.parse_channel_feed(xml)
        self.assertEqual(len(videos), competitor_radar.BASELINE_VIDEO_COUNT)


class TestCompetitorRadarStartupContract(unittest.TestCase):
    def test_channel_isolation_preflight_fails_closed(self):
        invalid_channels = (
            {"gpm_profile_id": "", "gpm_proxy_info": "http://127.0.0.1:8080"},
            {"gpm_profile_id": "profile-1", "gpm_proxy_info": ""},
        )
        for channel in invalid_channels:
            with self.subTest(channel=channel), self.assertRaises(HTTPException) as error:
                main._require_radar_channel_isolation(channel)
            self.assertEqual(error.exception.status_code, 409)

    def test_startup_recovers_jobs_but_does_not_enqueue_or_scan_directly(self):
        main_path = Path(__file__).parents[1] / "src" / "auto_yt" / "main.py"
        source = main_path.read_text(encoding="utf-8")
        startup = source[source.index("def resume_background_jobs") : source.index("@app.on_event(\"shutdown\")")]
        self.assertIn('db.recover_interrupted_system_jobs("competitor_scan")', startup)
        self.assertIn("target=_competitor_radar_scheduler", startup)
        self.assertNotIn("_enqueue_competitor_scan(", startup)
        self.assertNotIn("resolve_competitor_channel(", startup)
        shutdown = source[source.index('def stop_video_queue_wakeup_timer') : source.index('class VideoJobCanceled')]
        self.assertIn("_competitor_radar_stop_event.set()", shutdown)
        self.assertIn("_competitor_radar_thread.join(timeout=5)", shutdown)


if __name__ == "__main__":
    unittest.main()
