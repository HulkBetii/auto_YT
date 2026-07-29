#!/usr/bin/env python3
"""Replace one generated Study album track through AI33.PRO."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import time
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

from generate_study_music import (
    AI33Client,
    AudioProbe,
    AmbiguousSubmissionError,
    GenerationError,
    MAX_BACKOFF_SEC,
    MAX_PROVIDER_TASKS,
    MAX_RUNTIME_SEC,
    MIN_TRACK_DURATION_SEC,
    ProviderTaskResult,
    ProviderTransientError,
    StaleGenerationError,
    TRACK_COUNT,
    _media_root,
    _database_url,
    _probe_audio,
    _sha256_file,
    _api_key,
    normalize_generation_manifest,
    task_index_for_slot,
    utc_now,
)


class RegenerationStore:
    """Small DB adapter with the same lease guard as full generation."""

    async def _connect(self):
        import asyncpg

        return await asyncpg.connect(
            _database_url(), statement_cache_size=0, timeout=30
        )

    async def load(self, week_id: int) -> dict[str, Any]:
        conn = await self._connect()
        try:
            row = await conn.fetchrow(
                """
                SELECT id, week_number, status, generation_manifest, generation_run_id,
                       track_manifest, total_duration_sec, rights_verified_at
                FROM study_audio_weeks WHERE id = $1
                """,
                week_id,
            )
        finally:
            await conn.close()
        if row is None:
            raise GenerationError(f"Study audio week #{week_id} was not found.")
        return dict(row)

    async def save_progress(
        self,
        week_id: int,
        run_id: str,
        manifest: dict[str, Any],
        error_message: str | None = None,
    ) -> None:
        manifest["updatedAt"] = utc_now()
        conn = await self._connect()
        try:
            result = await conn.execute(
                """
                UPDATE study_audio_weeks
                SET generation_manifest = $1::jsonb,
                    generation_heartbeat_at = NOW(), error_message = $2, updated_at = NOW()
                WHERE id = $3 AND generation_run_id = $4 AND status = 'generating'
                """,
                json.dumps(manifest), error_message, week_id, run_id,
            )
        finally:
            await conn.close()
        if result != "UPDATE 1":
            raise StaleGenerationError("This regeneration run no longer owns the lease.")

    async def restore_failure(
        self,
        week_id: int,
        run_id: str,
        previous_status: str,
        rights_verified_at: Any,
        manifest: dict[str, Any],
        error_message: str,
    ) -> None:
        task = next(
            (task for task in reversed(manifest.get("tasks", [])) if task.get("targetSlot") == manifest.get("activeRegeneration", {}).get("targetSlot")),
            None,
        )
        if task is not None:
            task["status"] = "error"
            task["finishedAt"] = utc_now()
            task["errorMessage"] = error_message[:2000]
        manifest.pop("activeRegeneration", None)
        manifest["updatedAt"] = utc_now()
        conn = await self._connect()
        try:
            result = await conn.execute(
                """
                UPDATE study_audio_weeks
                SET status = $1, rights_verified_at = $2, generation_manifest = $3::jsonb,
                    generation_finished_at = NOW(), error_message = $4, updated_at = NOW()
                WHERE id = $5 AND generation_run_id = $6 AND status = 'generating'
                """,
                previous_status, rights_verified_at, json.dumps(manifest), error_message[:4000],
                week_id, run_id,
            )
        finally:
            await conn.close()
        if result != "UPDATE 1":
            raise StaleGenerationError("This regeneration run no longer owns the lease.")

    async def finalize(
        self,
        week_id: int,
        run_id: str,
        slot_number: int,
        manifest: dict[str, Any],
        track_manifest: dict[str, Any],
        total_duration_sec: int,
        staged_path: Path,
        final_path: Path,
        backup_path: Path,
    ) -> None:
        """Promote and commit while a row lock prevents a stale worker race."""
        conn = await self._connect()
        promoted = False
        try:
            transaction = conn.transaction()
            await transaction.start()
            row = await conn.fetchrow(
                """
                SELECT status, generation_run_id FROM study_audio_weeks
                WHERE id = $1 FOR UPDATE
                """,
                week_id,
            )
            if not row or row["status"] != "generating" or row["generation_run_id"] != run_id:
                raise StaleGenerationError("This regeneration run no longer owns the lease.")
            if not staged_path.exists() or not backup_path.exists():
                raise GenerationError("Regeneration journal is missing its staged or backup file.")
            os.replace(staged_path, final_path)
            promoted = True
            result = await conn.execute(
                """
                UPDATE study_audio_weeks
                SET status = 'awaiting_rights', rights_verified_at = NULL,
                    generation_manifest = $1::jsonb, track_manifest = $2::jsonb,
                    total_duration_sec = $3, generation_finished_at = NOW(),
                    generation_heartbeat_at = NOW(), error_message = NULL, updated_at = NOW()
                WHERE id = $4 AND generation_run_id = $5 AND status = 'generating'
                """,
                json.dumps(manifest), json.dumps(track_manifest), total_duration_sec,
                week_id, run_id,
            )
            if result != "UPDATE 1":
                raise StaleGenerationError("This regeneration run lost its lease before completion.")
            await transaction.commit()
        except Exception:
            try:
                await transaction.rollback()
            except Exception:
                pass
            if promoted and backup_path.exists():
                os.replace(backup_path, final_path)
            raise
        finally:
            await conn.close()


class RegenerationRunner:
    def __init__(self, store: RegenerationStore, client: AI33Client, media_root: Path):
        self.store = store
        self.client = client
        self.media_root = media_root.resolve()
        self.started = time.monotonic()

    def _assert_runtime(self) -> None:
        if time.monotonic() - self.started >= MAX_RUNTIME_SEC:
            raise GenerationError("Music regeneration exceeded the 90-minute runtime limit.")

    async def run(self, week_id: int, run_id: str, slot_number: int) -> None:
        context = await self.store.load(week_id)
        if context.get("status") != "generating" or context.get("generation_run_id") != run_id:
            raise StaleGenerationError("The regenerate API must claim this week first.")
        manifest = normalize_generation_manifest(context.get("generation_manifest"))
        journal = manifest.get("activeRegeneration")
        if not isinstance(journal, dict) or journal.get("runId") != run_id or journal.get("targetSlot") != slot_number:
            raise StaleGenerationError("Regeneration journal does not belong to this run.")
        if not 1 <= slot_number <= TRACK_COUNT:
            raise GenerationError("Track slot must be between 1 and 20.")
        week_dir = self.media_root / "audio" / f"week-{int(context['week_number']):03d}"
        generation_dir = week_dir / "_generation"
        replacement_dir = generation_dir / "replaced"
        generation_dir.mkdir(parents=True, exist_ok=True)
        replacement_dir.mkdir(parents=True, exist_ok=True)
        final_path = week_dir / f"{slot_number:02d}.mp3"
        staged_path = self._journal_path(
            journal.get("stagedRelativePath"),
            generation_dir / f"regenerate-{slot_number:02d}-{run_id}.mp3.part",
        )
        timestamp = str(journal.get("startedAt", utc_now())).replace(":", "").replace("-", "")
        backup_path = self._journal_path(
            journal.get("backupRelativePath"),
            replacement_dir / f"{slot_number:02d}-{timestamp}.mp3",
        )

        try:
            if journal.get("state") not in {"staged", "backed_up", "promoted"}:
                task = self._get_or_submit_task(manifest, journal, slot_number)
                await self._poll_and_stage(
                    week_id, run_id, manifest, task, slot_number, staged_path, generation_dir
                )
                journal["state"] = "staged"
                journal["stagedRelativePath"] = staged_path.relative_to(self.media_root).as_posix()
                journal["updatedAt"] = utc_now()
                await self.store.save_progress(week_id, run_id, manifest)

            if not backup_path.exists():
                if not final_path.exists():
                    raise GenerationError(f"Track file is missing: {final_path.name}")
                backup_tmp = backup_path.with_suffix(".part")
                shutil.copy2(final_path, backup_tmp)
                os.replace(backup_tmp, backup_path)
                journal["state"] = "backed_up"
                journal["backupRelativePath"] = backup_path.relative_to(self.media_root).as_posix()
                journal["updatedAt"] = utc_now()
                await self.store.save_progress(week_id, run_id, manifest)

            probe = _probe_audio(staged_path)
            current = context.get("track_manifest") or {"files": []}
            files = list(current.get("files") or [])
            replacement = self._slot_manifest(slot_number, manifest, probe)
            files = [replacement if file.get("fileName") == final_path.name else file for file in files]
            if len(files) != TRACK_COUNT or not any(file.get("fileName") == final_path.name for file in files):
                raise GenerationError("Track manifest is incomplete; refusing replacement.")
            track_manifest = {"files": files, "scannedAt": utc_now()}
            final_manifest = deepcopy(manifest)
            final_manifest.pop("activeRegeneration", None)
            await self.store.finalize(
                week_id, run_id, slot_number, final_manifest, track_manifest,
                int(round(sum(float(file["durationSec"]) for file in files))),
                staged_path, final_path, backup_path,
            )
            print(f"Study track slot #{slot_number} regenerated.")
        except StaleGenerationError:
            raise
        except Exception as exc:
            staged_path.unlink(missing_ok=True)
            original_slot = journal.get("originalSlot")
            original_hash = original_slot.get("sha256") if isinstance(original_slot, dict) else None
            if backup_path.exists() and (
                not final_path.exists()
                or not isinstance(original_hash, str)
                or _sha256_file(final_path) != original_hash
            ):
                os.replace(backup_path, final_path)
            if isinstance(original_slot, dict):
                manifest["slots"][slot_number - 1] = deepcopy(original_slot)
            try:
                await self.store.restore_failure(
                    week_id, run_id, str(journal.get("previousStatus", "awaiting_rights")),
                    self._rights_timestamp(journal.get("previousRightsVerifiedAt")),
                    manifest, str(exc),
                )
            except StaleGenerationError:
                pass
            raise

    def _journal_path(self, relative_path: Any, fallback: Path) -> Path:
        if not isinstance(relative_path, str) or not relative_path:
            return fallback
        resolved = (self.media_root / Path(relative_path)).resolve()
        if self.media_root not in resolved.parents:
            raise GenerationError("Regeneration journal contains an unsafe file path.")
        return resolved

    @staticmethod
    def _rights_timestamp(value: Any) -> datetime | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise GenerationError("Regeneration journal has invalid rights data.")
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise GenerationError("Regeneration journal has invalid rights data.") from exc

    def _get_or_submit_task(
        self,
        manifest: dict[str, Any],
        journal: dict[str, Any],
        slot_number: int,
    ) -> dict[str, Any]:
        submission_index = journal.get("submissionIndex")
        task = next(
            (task for task in manifest["tasks"] if task.get("submissionIndex") == submission_index),
            None,
        )
        if submission_index is not None and task is None:
            raise GenerationError("Regeneration journal references a missing provider task.")
        if task is not None:
            if task.get("status") == "submitting":
                raise GenerationError("Previous regeneration submission has unknown outcome.")
            if task.get("status") == "ambiguous":
                raise GenerationError("Previous regeneration submission has unknown outcome.")
            return task
        if len(manifest["tasks"]) >= MAX_PROVIDER_TASKS:
            raise GenerationError("AI33 provider task cap reached.")
        task = {
            "submissionIndex": len(manifest["tasks"]) + 1,
            "taskIndex": task_index_for_slot(slot_number),
            "targetSlot": slot_number,
            "status": "submitting",
            "submittedAt": utc_now(),
        }
        manifest["tasks"].append(task)
        journal["submissionIndex"] = task["submissionIndex"]
        journal["state"] = "submitting"
        journal["updatedAt"] = utc_now()
        return task

    async def _poll_and_stage(
        self,
        week_id: int,
        run_id: str,
        manifest: dict[str, Any],
        task: dict[str, Any],
        slot_number: int,
        staged_path: Path,
        generation_dir: Path,
    ) -> None:
        if task.get("status") == "submitting":
            await self.store.save_progress(week_id, run_id, manifest)
            try:
                task_id, credits = await asyncio.to_thread(self.client.submit_task)
            except AmbiguousSubmissionError:
                task["status"] = "ambiguous"
                task["finishedAt"] = utc_now()
                await self.store.save_progress(week_id, run_id, manifest)
                raise
            except ProviderTransientError as exc:
                task["status"] = "error"
                task["finishedAt"] = utc_now()
                task["errorMessage"] = str(exc)
                await self.store.save_progress(week_id, run_id, manifest, str(exc))
                raise
            task["providerTaskId"] = task_id
            task["status"] = "doing"
            if credits is not None:
                manifest["lastKnownCredits"] = credits
            await self.store.save_progress(week_id, run_id, manifest)

        while True:
            self._assert_runtime()
            result = await asyncio.to_thread(self.client.poll_task, str(task["providerTaskId"]))
            if isinstance(result, ProviderTaskResult) and result.status == "done":
                downloaded = await self._download_first_valid_clip(
                    result.clips, manifest, slot_number, staged_path
                )
                if downloaded is None:
                    raise GenerationError("Provider returned no valid unique clip for this slot.")
                probe, clip = downloaded
                slot = manifest["slots"][slot_number - 1]
                slot.update({
                    "status": "downloaded",
                    "sha256": probe.sha256,
                    "sizeBytes": probe.size_bytes,
                    "durationSec": probe.duration_sec,
                    "codecName": probe.codec_name,
                    "sampleRate": probe.sample_rate,
                    "channels": probe.channels,
                    "providerTaskId": task["providerTaskId"],
                    "providerClipId": clip.clip_id,
                    "sourceUrl": clip.url,
                })
                task["status"] = "done"
                task["finishedAt"] = utc_now()
                await self.store.save_progress(week_id, run_id, manifest)
                return
            if isinstance(result, ProviderTaskResult) and result.status == "error":
                raise GenerationError(result.error_message or "Provider task failed.")
            await asyncio.sleep(10)

    async def _download_first_valid_clip(
        self,
        clips: Any,
        manifest: dict[str, Any],
        slot_number: int,
        staged_path: Path,
    ) -> tuple[AudioProbe, Any] | None:
        existing_hashes = {
            str(slot.get("sha256"))
            for slot in manifest["slots"]
            if slot.get("status") == "downloaded" and int(slot.get("slotNumber", 0)) != slot_number
        }
        for index, clip in enumerate(clips, start=1):
            staged_path.unlink(missing_ok=True)
            try:
                await asyncio.to_thread(self.client.download, clip.url, staged_path)
                probe = await asyncio.to_thread(_probe_audio, staged_path)
            except Exception:
                continue
            if probe.duration_sec < MIN_TRACK_DURATION_SEC or probe.sha256 in existing_hashes:
                staged_path.unlink(missing_ok=True)
                continue
            return probe, clip
        return None

    @staticmethod
    def _slot_manifest(slot_number: int, manifest: dict[str, Any], probe: AudioProbe) -> dict[str, Any]:
        slot = next(slot for slot in manifest["slots"] if int(slot["slotNumber"]) == slot_number)
        return {
            "fileName": f"{slot_number:02d}.mp3",
            "relativePath": slot.get("relativePath", f"audio/week-001/{slot_number:02d}.mp3"),
            "sha256": probe.sha256,
            "sizeBytes": probe.size_bytes,
            "durationSec": probe.duration_sec,
            "codecName": probe.codec_name,
            "sampleRate": probe.sample_rate,
            "channels": probe.channels,
        }


async def main_async(week_id: int, run_id: str, slot_number: int) -> None:
    store = RegenerationStore()
    runner = RegenerationRunner(store, AI33Client(_api_key()), _media_root())
    await runner.run(week_id, run_id, slot_number)


def main() -> None:
    parser = argparse.ArgumentParser(description="Regenerate one Study music track through AI33.PRO.")
    parser.add_argument("week_id", type=int)
    parser.add_argument("run_id")
    parser.add_argument("slot", type=int)
    args = parser.parse_args()
    try:
        asyncio.run(main_async(args.week_id, args.run_id, args.slot))
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
