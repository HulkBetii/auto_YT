from __future__ import annotations

import asyncio
import hashlib
import os
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from generate_study_music import (  # noqa: E402
    AudioProbe,
    GenerationError,
    ProviderClip,
    ProviderTaskResult,
    create_generation_manifest,
)
from regenerate_study_music import RegenerationRunner  # noqa: E402


def probe(path: Path) -> AudioProbe:
    payload = path.read_bytes()
    return AudioProbe(
        sha256=hashlib.sha256(payload).hexdigest(),
        size_bytes=len(payload),
        duration_sec=120.0,
        codec_name="mp3",
        sample_rate=44100,
        channels=2,
    )


def completed_manifest() -> dict:
    manifest = create_generation_manifest()
    for task_index in range(1, 11):
        manifest["tasks"].append({
            "submissionIndex": task_index,
            "taskIndex": task_index,
            "status": "done",
            "providerTaskId": f"task-{task_index}",
            "submittedAt": "2026-07-27T00:00:00.000Z",
        })
    for slot in manifest["slots"]:
        number = int(slot["slotNumber"])
        slot.update({
            "status": "downloaded",
            "fileName": f"{number:02d}.mp3",
            "relativePath": f"audio/week-001/{number:02d}.mp3",
            "sha256": f"old-{number}",
            "sizeBytes": 10,
            "durationSec": 120.0,
            "codecName": "mp3",
            "sampleRate": 44100,
            "channels": 2,
        })
    return manifest


class FakeStore:
    def __init__(self, root: Path, manifest: dict):
        self.root = root
        self.manifest = deepcopy(manifest)
        self.restored = None
        self.finalized = None
        self.context = {
            "id": 1,
            "week_number": 1,
            "status": "generating",
            "generation_run_id": "run-1",
            "generation_manifest": self.manifest,
            "track_manifest": {
                "files": [
                    {
                        "fileName": f"{index:02d}.mp3",
                        "relativePath": f"audio/week-001/{index:02d}.mp3",
                        "sha256": f"old-{index}",
                        "sizeBytes": 10,
                        "durationSec": 120.0,
                        "codecName": "mp3",
                        "sampleRate": 44100,
                        "channels": 2,
                    }
                    for index in range(1, 21)
                ]
            },
            "rights_verified_at": "2026-07-27T00:00:00Z",
        }

    async def load(self, week_id):
        value = dict(self.context)
        value["generation_manifest"] = deepcopy(self.manifest)
        return value

    async def save_progress(self, week_id, run_id, manifest, error_message=None):
        self.manifest = deepcopy(manifest)

    async def restore_failure(
        self, week_id, run_id, previous_status, rights_verified_at, manifest, error_message
    ):
        task = next(
            (task for task in reversed(manifest["tasks"]) if task.get("targetSlot") == 7), None
        )
        if task is not None:
            task["status"] = "error"
        manifest.pop("activeRegeneration", None)
        self.restored = (previous_status, rights_verified_at, deepcopy(manifest), error_message)

    async def finalize(
        self, week_id, run_id, slot_number, manifest, track_manifest,
        total_duration_sec, staged_path, final_path, backup_path,
    ):
        os.replace(staged_path, final_path)
        self.finalized = (deepcopy(manifest), deepcopy(track_manifest), total_duration_sec)


class FakeClient:
    def __init__(self, duplicate=False):
        self.duplicate = duplicate
        self.submissions = 0

    def submit_task(self):
        self.submissions += 1
        return "replacement-task", 8000

    def poll_task(self, task_id):
        return ProviderTaskResult(
            status="done",
            clips=(ProviderClip("https://cdn/replacement.mp3", "clip-1"),),
        )

    def download(self, url, destination):
        destination.write_bytes(b"replacement")


class FailedClient(FakeClient):
    def poll_task(self, task_id):
        return ProviderTaskResult(status="error", error_message="provider failed")


class RegenerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_replaces_exactly_one_slot_and_keeps_backup(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            week_dir = root / "audio" / "week-001"
            week_dir.mkdir(parents=True)
            for number in range(1, 21):
                (week_dir / f"{number:02d}.mp3").write_bytes(f"original-{number}".encode())
            manifest = completed_manifest()
            manifest["activeRegeneration"] = {
                "runId": "run-1",
                "targetSlot": 7,
                "previousStatus": "ready",
                "previousRightsVerifiedAt": "2026-07-27T00:00:00Z",
                "state": "claimed",
                "originalSlot": deepcopy(manifest["slots"][6]),
                "originalTrack": {},
                "startedAt": "2026-07-27T00:00:00Z",
                "updatedAt": "2026-07-27T00:00:00Z",
            }
            store = FakeStore(root, manifest)
            runner = RegenerationRunner(store, FakeClient(), root)
            with patch("regenerate_study_music._probe_audio", side_effect=probe):
                await runner.run(1, "run-1", 7)

            self.assertIsNotNone(store.finalized)
            final_manifest, tracks, _ = store.finalized
            self.assertNotIn("activeRegeneration", final_manifest)
            self.assertEqual(final_manifest["tasks"][-1]["targetSlot"], 7)
            self.assertNotEqual(final_manifest["slots"][6]["sha256"], "old-7")
            self.assertEqual(tracks["files"][6]["sha256"], final_manifest["slots"][6]["sha256"])
            self.assertEqual((week_dir / "07.mp3").read_bytes(), b"replacement")
            backups = list((week_dir / "_generation" / "replaced").glob("07-*.mp3"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), b"original-7")

    def test_new_regeneration_never_reuses_an_old_task_for_the_same_slot(self) -> None:
        manifest = completed_manifest()
        manifest["tasks"].append({
            "submissionIndex": 11,
            "taskIndex": 4,
            "targetSlot": 7,
            "status": "done",
            "providerTaskId": "old-replacement",
            "submittedAt": "2026-07-27T00:00:00Z",
        })
        journal = {"state": "claimed", "updatedAt": "2026-07-27T00:00:00Z"}
        runner = RegenerationRunner(None, None, Path(tempfile.gettempdir()))
        task = runner._get_or_submit_task(manifest, journal, 7)
        self.assertEqual(task["submissionIndex"], 12)
        self.assertEqual(journal["submissionIndex"], 12)

    def test_task_cap_blocks_before_provider_submission(self) -> None:
        manifest = completed_manifest()
        while len(manifest["tasks"]) < 20:
            manifest["tasks"].append({
                "submissionIndex": len(manifest["tasks"]) + 1,
                "taskIndex": 1,
                "status": "error",
                "submittedAt": "2026-07-27T00:00:00Z",
            })
        runner = RegenerationRunner(None, None, Path(tempfile.gettempdir()))
        with self.assertRaises(GenerationError):
            runner._get_or_submit_task(manifest, {"state": "claimed"}, 7)

    async def test_failure_restores_original_slot_status_rights_and_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            week_dir = root / "audio" / "week-001"
            week_dir.mkdir(parents=True)
            original = b"original-7"
            for number in range(1, 21):
                (week_dir / f"{number:02d}.mp3").write_bytes(original if number == 7 else b"other")
            manifest = completed_manifest()
            manifest["activeRegeneration"] = {
                "runId": "run-1",
                "targetSlot": 7,
                "previousStatus": "ready",
                "previousRightsVerifiedAt": "2026-07-27T00:00:00Z",
                "state": "claimed",
                "originalSlot": deepcopy(manifest["slots"][6]),
                "originalTrack": {},
                "startedAt": "2026-07-27T00:00:00Z",
                "updatedAt": "2026-07-27T00:00:00Z",
            }
            store = FakeStore(root, manifest)
            runner = RegenerationRunner(store, FailedClient(), root)
            with patch("regenerate_study_music._probe_audio", side_effect=probe):
                with self.assertRaises(GenerationError):
                    await runner.run(1, "run-1", 7)
            self.assertIsNotNone(store.restored)
            previous_status, rights, restored_manifest, _ = store.restored
            self.assertEqual(previous_status, "ready")
            self.assertEqual(rights.isoformat(), "2026-07-27T00:00:00+00:00")
            self.assertEqual(restored_manifest["slots"][6]["sha256"], "old-7")
            self.assertEqual(restored_manifest["tasks"][-1]["status"], "error")
            self.assertNotIn("activeRegeneration", restored_manifest)
            self.assertEqual((week_dir / "07.mp3").read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
