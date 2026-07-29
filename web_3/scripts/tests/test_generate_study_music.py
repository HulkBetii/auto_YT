from __future__ import annotations

import asyncio
import hashlib
import io
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from generate_study_music import (  # noqa: E402
    AmbiguousSubmissionError,
    AI33Client,
    AudioProbe,
    LEGACY_PHASE_TASK_INDEX,
    GenerationError,
    GenerationRunner,
    PROMPT_VERSION,
    ProviderClip,
    ProviderTransientError,
    ProviderTaskResult,
    StaleGenerationError,
    STUDY_STYLE_PROMPT,
    TRACK_COUNT,
    build_prompt,
    create_generation_manifest,
    extract_provider_clips,
    next_task_index_for_submission,
    normalize_generation_manifest,
    parse_provider_task,
    task_index_for_slot,
)

LEGACY_PHASES = tuple(LEGACY_PHASE_TASK_INDEX)


class ManifestTests(unittest.TestCase):
    def test_manifest_has_twenty_slots_and_task_indexes(self) -> None:
        manifest = create_generation_manifest()
        self.assertEqual(len(manifest["slots"]), TRACK_COUNT)
        self.assertEqual(manifest["slots"][0]["taskIndex"], 1)
        self.assertEqual(manifest["slots"][1]["taskIndex"], 1)
        self.assertEqual(manifest["slots"][19]["taskIndex"], 10)
        self.assertEqual(task_index_for_slot(20), 10)
        self.assertTrue(all("phase" not in slot for slot in manifest["slots"]))
        self.assertEqual(manifest["promptVersion"], PROMPT_VERSION)

    def test_all_tracks_use_the_fixed_style_prompt(self) -> None:
        self.assertEqual(
            build_prompt(),
            "Organic acoustic ambient study music, felt piano and "
            "nylon-string guitar, warm analog pad, soft room tone, "
            "no drums, no percussion, no vocals, no lead synth, "
            "68 BPM, key of A minor, sparse and unhurried, "
            "gentle consistent dynamics, natural reverb tail",
        )
        self.assertEqual(build_prompt(), STUDY_STYLE_PROMPT)

    def test_submission_order_attempts_ten_task_indexes_then_topups(self) -> None:
        manifest = create_generation_manifest()
        for task_index in range(1, 11):
            manifest["tasks"].append(
                {
                    "submissionIndex": len(manifest["tasks"]) + 1,
                    "taskIndex": task_index,
                    "status": "done",
                    "providerTaskId": f"task-{len(manifest['tasks']) + 1}",
                }
            )
        for slot in manifest["slots"]:
            slot["status"] = "downloaded"
        self.assertIsNone(next_task_index_for_submission(manifest))
        manifest["slots"][0]["status"] = "pending"
        self.assertEqual(next_task_index_for_submission(manifest), 1)

    def test_legacy_phase_manifest_is_canonicalized_to_task_indexes(self) -> None:
        manifest = create_generation_manifest()
        for slot in manifest["slots"]:
            task_index = slot.pop("taskIndex")
            slot["phase"] = LEGACY_PHASES[task_index - 1]
        manifest["tasks"].append(
            {
                "submissionIndex": 1,
                "phase": LEGACY_PHASES[0],
                "status": "done",
                "providerTaskId": "legacy-task",
                "submittedAt": "2026-01-01T00:00:00.000Z",
            }
        )

        normalized = normalize_generation_manifest(manifest)

        self.assertEqual(normalized["tasks"][0]["taskIndex"], 1)
        self.assertNotIn("phase", normalized["tasks"][0])
        self.assertEqual(normalized["slots"][19]["taskIndex"], 10)
        self.assertTrue(all("phase" not in slot for slot in normalized["slots"]))

    def test_normalization_rejects_invalid_task_count(self) -> None:
        manifest = create_generation_manifest()
        manifest["maxProviderTasks"] = 19
        with self.assertRaises(GenerationError):
            normalize_generation_manifest(manifest)

    def test_provider_clips_supports_clips_and_fallback_fields(self) -> None:
        payload = {
            "metadata": {
                "suno_result": {
                    "clips": [
                        {"id": "a", "audio_url": "https://cdn/a.mp3"},
                        {"id": "b", "audio_url": "https://cdn/b.mp3"},
                    ]
                },
                "all_audio_urls": ["https://cdn/b.mp3", "https://cdn/c.mp3"],
                "audio_url": "https://cdn/d.mp3",
            }
        }
        clips = extract_provider_clips(payload)
        self.assertEqual([clip.url for clip in clips], [
            "https://cdn/a.mp3",
            "https://cdn/b.mp3",
            "https://cdn/c.mp3",
            "https://cdn/d.mp3",
        ])
        result = parse_provider_task(payload | {"status": "done"})
        self.assertEqual(result.status, "done")
        self.assertEqual(len(result.clips), 4)

    def test_done_without_audio_is_error(self) -> None:
        result = parse_provider_task({"status": "done", "metadata": {}})
        self.assertEqual(result.status, "error")

    def test_provider_http_retry_classification(self) -> None:
        client = AI33Client("test-key")
        rate_limit = HTTPError("url", 429, "busy", None, io.BytesIO(b"busy"))
        with patch("generate_study_music.urlopen", side_effect=rate_limit):
            with self.assertRaises(ProviderTransientError):
                client.submit_task()

        server_error = HTTPError("url", 500, "error", None, io.BytesIO(b"error"))
        with patch("generate_study_music.urlopen", side_effect=server_error):
            with self.assertRaises(AmbiguousSubmissionError):
                client.submit_task()

        poll_error = HTTPError("url", 503, "error", None, io.BytesIO(b"error"))
        with patch("generate_study_music.urlopen", side_effect=poll_error):
            with self.assertRaises(ProviderTransientError):
                client.poll_task("task-1")

    def test_provider_submission_uses_fixed_instrumental_prompt(self) -> None:
        client = AI33Client("test-key")
        with patch.object(
            client,
            "_json_request",
            return_value={"task_id": "task-1", "ec_remain_credits": 9000},
        ) as request:
            task_id, credits = client.submit_task()

        self.assertEqual((task_id, credits), ("task-1", 9000))
        request.assert_called_once_with(
            "POST",
            "/v1s/task/music-generation",
            {
                "create_mode": "simple",
                "gpt_description_prompt": STUDY_STYLE_PROMPT,
                "make_instrumental": True,
            },
        )


class FakeStore:
    def __init__(self, manifest=None):
        self.context = {
            "id": 7,
            "week_number": 1,
            "status": "generating",
            "generation_run_id": "run-1",
            "generation_manifest": manifest,
        }
        self.manifest = deepcopy(manifest)
        self.completed = None
        self.failed = None

    async def load(self, week_id):
        value = dict(self.context)
        value["generation_manifest"] = deepcopy(self.manifest)
        return value

    async def save_progress(self, week_id, run_id, manifest, error_message=None):
        if self.context["generation_run_id"] != run_id:
            raise RuntimeError("stale")
        self.manifest = deepcopy(manifest)

    async def complete(self, week_id, run_id, manifest, track_manifest, total_duration_sec):
        self.completed = (deepcopy(manifest), deepcopy(track_manifest), total_duration_sec)
        self.context["status"] = "awaiting_rights"

    async def fail(self, week_id, run_id, manifest, error_message):
        self.failed = (deepcopy(manifest), error_message)
        self.context["status"] = "failed"


class FakeClient:
    def __init__(self, clips_per_task=2):
        self.clips_per_task = clips_per_task
        self.submissions = []
        self.polls = []

    def submit_task(self):
        task_id = f"task-{len(self.submissions) + 1}"
        self.submissions.append(task_id)
        return task_id, 1000 - len(self.submissions)

    def poll_task(self, task_id):
        self.polls.append(task_id)
        clips = tuple(
            ProviderClip(
                url=f"https://cdn/{task_id}-{index}.mp3",
                clip_id=f"{task_id}-clip-{index}",
            )
            for index in range(self.clips_per_task)
        )
        return ProviderTaskResult(status="done", clips=clips)

    def download(self, url, destination):
        destination.write_bytes(url.encode("utf-8"))


def fake_probe(path: Path) -> AudioProbe:
    payload = path.read_bytes()
    return AudioProbe(
        sha256=hashlib.sha256(payload).hexdigest(),
        size_bytes=len(payload),
        duration_sec=60.0 + len(payload) / 1000.0,
        codec_name="mp3",
        sample_rate=44100,
        channels=2,
    )


class RunnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_runner_generates_twenty_tracks_with_max_three_in_flight(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            store = FakeStore()
            store.context["week_number"] = 53
            client = FakeClient(clips_per_task=2)
            runner = GenerationRunner(
                store,
                client,
                Path(temp),
                poll_interval_sec=0,
                max_runtime_sec=10,
                sleep=lambda _: asyncio.sleep(0),
                probe_audio=fake_probe,
            )
            await runner.run(7, "run-1")
            self.assertIsNotNone(store.completed)
            manifest, track_manifest, total_duration = store.completed
            self.assertEqual(len(manifest["tasks"]), 10)
            self.assertEqual(
                [task["taskIndex"] for task in manifest["tasks"]],
                list(range(1, 11)),
            )
            self.assertTrue(all("phase" not in task for task in manifest["tasks"]))
            self.assertEqual(len(track_manifest["files"]), 20)
            self.assertEqual([item["fileName"] for item in track_manifest["files"]], [
                f"{index:02d}.mp3" for index in range(1, 21)
            ])
            self.assertEqual(total_duration, int(round(sum(
                item["durationSec"] for item in track_manifest["files"]
            ))))
            self.assertTrue((Path(temp) / "audio" / "week-053" / "01.mp3").exists())

    async def test_runner_rejects_week_above_supported_range(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            store = FakeStore()
            store.context["week_number"] = 54
            client = FakeClient()
            runner = GenerationRunner(store, client, Path(temp), max_runtime_sec=10)
            with self.assertRaisesRegex(GenerationError, "Invalid study week number: 54"):
                await runner.run(7, "run-1")
            self.assertEqual(client.submissions, [])

    async def test_runner_topups_to_hard_cap_when_provider_returns_one_clip(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            store = FakeStore()
            client = FakeClient(clips_per_task=1)
            runner = GenerationRunner(
                store,
                client,
                Path(temp),
                poll_interval_sec=0,
                max_runtime_sec=10,
                sleep=lambda _: asyncio.sleep(0),
                probe_audio=fake_probe,
            )
            await runner.run(7, "run-1")
            self.assertEqual(len(client.submissions), 20)
            self.assertEqual(len(store.completed[1]["files"]), 20)

    async def test_duplicate_clip_is_skipped_and_extra_clip_fills_pair(self) -> None:
        class DuplicateExtraClient(FakeClient):
            def __init__(self):
                super().__init__(clips_per_task=3)

            def download(self, url, destination):
                # Clip 2 duplicates clip 1; clip 3 is the deterministic replacement.
                payload = url.replace("-1.mp3", "-0.mp3")
                destination.write_bytes(payload.encode("utf-8"))

        with tempfile.TemporaryDirectory() as temp:
            store = FakeStore()
            client = DuplicateExtraClient()
            runner = GenerationRunner(
                store,
                client,
                Path(temp),
                poll_interval_sec=0,
                max_runtime_sec=10,
                sleep=lambda _: asyncio.sleep(0),
                probe_audio=fake_probe,
            )
            await runner.run(7, "run-1")
            self.assertEqual(len(client.submissions), 10)
            source_urls = [slot["sourceUrl"] for slot in store.completed[0]["slots"]]
            self.assertTrue(all(url.endswith(("-0.mp3", "-2.mp3")) for url in source_urls))
            self.assertEqual(len({slot["sha256"] for slot in store.completed[0]["slots"]}), 20)

    async def test_provider_error_creates_one_replacement_task(self) -> None:
        class FirstTaskFailsClient(FakeClient):
            def poll_task(self, task_id):
                if task_id == "task-1":
                    return ProviderTaskResult(status="error", error_message="provider failed")
                return super().poll_task(task_id)

        with tempfile.TemporaryDirectory() as temp:
            store = FakeStore()
            client = FirstTaskFailsClient(clips_per_task=2)
            runner = GenerationRunner(
                store,
                client,
                Path(temp),
                poll_interval_sec=0,
                max_runtime_sec=10,
                sleep=lambda _: asyncio.sleep(0),
                probe_audio=fake_probe,
            )
            await runner.run(7, "run-1")
            self.assertEqual(len(client.submissions), 11)
            self.assertEqual(store.completed[0]["tasks"][0]["status"], "error")
            self.assertEqual(len(store.completed[1]["files"]), 20)

    async def test_download_failure_creates_replacement_task(self) -> None:
        class FirstTaskDownloadFailsClient(FakeClient):
            def download(self, url, destination):
                if "/task-1-" in url:
                    raise GenerationError("download failed")
                super().download(url, destination)

        with tempfile.TemporaryDirectory() as temp:
            store = FakeStore()
            client = FirstTaskDownloadFailsClient(clips_per_task=2)
            runner = GenerationRunner(
                store,
                client,
                Path(temp),
                poll_interval_sec=0,
                max_runtime_sec=10,
                sleep=lambda _: asyncio.sleep(0),
                probe_audio=fake_probe,
            )
            await runner.run(7, "run-1")
            self.assertEqual(len(client.submissions), 11)
            self.assertEqual(len(store.completed[1]["files"]), 20)

    async def test_resume_preserves_downloaded_files_and_completed_task(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            week_dir = root / "audio" / "week-001"
            week_dir.mkdir(parents=True)
            manifest = create_generation_manifest()
            for slot in manifest["slots"]:
                task_index = slot.pop("taskIndex")
                slot["phase"] = LEGACY_PHASES[task_index - 1]
            manifest["tasks"].append(
                {
                    "submissionIndex": 1,
                    "phase": LEGACY_PHASES[0],
                    "status": "done",
                    "providerTaskId": "old-task",
                    "submittedAt": "2026-01-01T00:00:00.000Z",
                    "finishedAt": "2026-01-01T00:01:00.000Z",
                }
            )
            original_payloads = []
            for slot_number in (1, 2):
                path = week_dir / f"{slot_number:02d}.mp3"
                payload = f"existing-{slot_number}".encode("utf-8")
                original_payloads.append(payload)
                path.write_bytes(payload)
                probe_result = fake_probe(path)
                manifest["slots"][slot_number - 1].update(
                    {
                        "status": "downloaded",
                        "fileName": path.name,
                        "relativePath": f"audio/week-001/{path.name}",
                        "sha256": probe_result.sha256,
                        "sizeBytes": probe_result.size_bytes,
                        "durationSec": probe_result.duration_sec,
                        "codecName": probe_result.codec_name,
                        "sampleRate": probe_result.sample_rate,
                        "channels": probe_result.channels,
                        "providerTaskId": "old-task",
                        "providerClipId": f"old-{slot_number}",
                        "sourceUrl": f"https://cdn/old-{slot_number}.mp3",
                    }
                )

            store = FakeStore(manifest)
            client = FakeClient(clips_per_task=2)
            runner = GenerationRunner(
                store,
                client,
                root,
                poll_interval_sec=0,
                max_runtime_sec=10,
                sleep=lambda _: asyncio.sleep(0),
                probe_audio=fake_probe,
            )
            await runner.run(7, "run-1")
            self.assertEqual(len(client.submissions), 9)
            self.assertEqual(store.completed[0]["tasks"][1]["taskIndex"], 2)
            self.assertTrue(all("phase" not in task for task in store.completed[0]["tasks"]))
            self.assertEqual((week_dir / "01.mp3").read_bytes(), original_payloads[0])
            self.assertEqual((week_dir / "02.mp3").read_bytes(), original_payloads[1])

    async def test_stale_run_id_is_rejected_before_provider_submission(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            store = FakeStore()
            store.context["generation_run_id"] = "newer-run"
            client = FakeClient()
            runner = GenerationRunner(store, client, Path(temp), max_runtime_sec=10)
            with self.assertRaises(StaleGenerationError):
                await runner.run(7, "run-1")
            self.assertEqual(client.submissions, [])

    async def test_submit_rate_limit_uses_bounded_exponential_backoff(self) -> None:
        class RateLimitedClient(FakeClient):
            def __init__(self):
                super().__init__()
                self.attempts = 0

            def submit_task(self):
                self.attempts += 1
                if self.attempts <= 2:
                    raise ProviderTransientError("rate limited")
                return super().submit_task()

        delays = []

        async def record_sleep(delay):
            delays.append(delay)

        store = FakeStore(create_generation_manifest())
        client = RateLimitedClient()
        runner = GenerationRunner(
            store,
            client,
            Path(tempfile.gettempdir()),
            poll_interval_sec=10,
            max_runtime_sec=100,
            sleep=record_sleep,
            monotonic=lambda: 0,
            probe_audio=fake_probe,
        )
        runner.deadline = 100
        manifest = create_generation_manifest()
        await runner._submit_one(7, "run-1", manifest, 1)
        self.assertEqual(delays, [10, 20])
        self.assertLessEqual(max(delays), 60)
        self.assertEqual(manifest["tasks"][0]["status"], "doing")

    async def test_ambiguous_submission_is_not_retried(self) -> None:
        class AmbiguousClient(FakeClient):
            def submit_task(self):
                raise AmbiguousSubmissionError("unknown")

        with tempfile.TemporaryDirectory() as temp:
            store = FakeStore()
            runner = GenerationRunner(
                store,
                AmbiguousClient(),
                Path(temp),
                poll_interval_sec=0,
                max_runtime_sec=10,
                sleep=lambda _: asyncio.sleep(0),
                probe_audio=fake_probe,
            )
            with self.assertRaises(AmbiguousSubmissionError):
                await runner.run(7, "run-1")
            self.assertEqual(store.manifest["tasks"][0]["status"], "ambiguous")

    async def test_unknown_manual_mp3_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            week_dir = Path(temp) / "audio" / "week-001"
            week_dir.mkdir(parents=True)
            (week_dir / "manual.mp3").write_bytes(b"manual")
            runner = GenerationRunner(FakeStore(), FakeClient(), Path(temp), max_runtime_sec=10)
            with self.assertRaises(GenerationError):
                await runner.run(7, "run-1")


if __name__ == "__main__":
    unittest.main()
