#!/usr/bin/env python3
"""Generate one 20-track Study With Me album through AI33.PRO."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

AI33_BASE_URL = "https://api.ai33.pro"
DEFAULT_STUDY_MEDIA_ROOT = Path(r"D:\VibeCoding\STUDY_WITH_ME")
PROMPT_VERSION = "study-organic-focus-v1"
PROVIDER_NAME = "ai33.pro"
TRACK_COUNT = 20
INITIAL_TASK_COUNT = 10
MAX_PROVIDER_TASKS = 20
MAX_IN_FLIGHT = 3
MIN_TRACK_DURATION_SEC = 60.0
POLL_INTERVAL_SEC = 10.0
MAX_BACKOFF_SEC = 60.0
MAX_RUNTIME_SEC = 90 * 60.0
DOWNLOAD_ATTEMPTS = 3
_ASYNCPG_UNSUPPORTED = {"channel_binding", "options"}

LEGACY_PHASE_TASK_INDEX = {
    "First light setup": 1,
    "Morning momentum": 2,
    "Clear desk flow": 3,
    "Deep work warmth": 4,
    "Late-morning concentration": 5,
    "Midday reset": 6,
    "Quiet persistence": 7,
    "Afternoon clarity": 8,
    "Steady finish": 9,
    "Golden-hour closure": 10,
}

STUDY_STYLE_PROMPT = (
    "Organic acoustic ambient study music, felt piano and "
    "nylon-string guitar, warm analog pad, soft room tone, "
    "no drums, no percussion, no vocals, no lead synth, "
    "68 BPM, key of A minor, sparse and unhurried, "
    "gentle consistent dynamics, natural reverb tail"
)

class GenerationError(RuntimeError):
    """Raised when a generation run cannot safely continue."""


class StaleGenerationError(GenerationError):
    """Raised when a newer run owns the database lease."""


class ProviderError(GenerationError):
    """Raised for a permanent provider response."""


class ProviderTransientError(GenerationError):
    """Raised for a safe-to-retry provider response."""


class AmbiguousSubmissionError(GenerationError):
    """Raised when a POST may have spent credits but returned no task id."""


@dataclass(frozen=True)
class ProviderClip:
    url: str
    clip_id: str | None = None


@dataclass(frozen=True)
class ProviderTaskResult:
    status: str
    clips: tuple[ProviderClip, ...] = ()
    error_message: str | None = None
    credit_cost: int | None = None


@dataclass(frozen=True)
class AudioProbe:
    sha256: str
    size_bytes: int
    duration_sec: float
    codec_name: str
    sample_rate: int | None
    channels: int | None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def build_prompt() -> str:
    if len(STUDY_STYLE_PROMPT) > 500:
        raise GenerationError("The AI33 simple-mode prompt exceeds 500 characters.")
    return STUDY_STYLE_PROMPT


def task_index_for_slot(slot_number: int) -> int:
    if not 1 <= slot_number <= TRACK_COUNT:
        raise GenerationError(f"slot_number must be between 1 and {TRACK_COUNT}.")
    return ((slot_number - 1) // 2) + 1


def _resolve_task_index(record: dict[str, Any], label: str) -> int:
    """Resolve new taskIndex data and legacy phase data to one canonical index."""
    raw_task_index = record.get("taskIndex")
    raw_phase = record.get("phase")
    task_index: int | None = None
    if raw_task_index is not None:
        if isinstance(raw_task_index, bool) or not isinstance(raw_task_index, int):
            raise GenerationError(f"{label} has an invalid taskIndex.")
        if not 1 <= raw_task_index <= TRACK_COUNT // 2:
            raise GenerationError(f"{label} has an invalid taskIndex.")
        task_index = raw_task_index
    if raw_phase is not None:
        if not isinstance(raw_phase, str) or raw_phase not in LEGACY_PHASE_TASK_INDEX:
            raise GenerationError(f"{label} has an invalid legacy phase.")
        legacy_task_index = LEGACY_PHASE_TASK_INDEX[raw_phase]
        if task_index is not None and task_index != legacy_task_index:
            raise GenerationError(f"{label} has conflicting taskIndex and phase.")
        task_index = legacy_task_index
    if task_index is None:
        raise GenerationError(f"{label} must define taskIndex or legacy phase.")
    return task_index


def create_generation_manifest() -> dict[str, Any]:
    now = utc_now()
    return {
        "promptVersion": PROMPT_VERSION,
        "provider": PROVIDER_NAME,
        "maxProviderTasks": MAX_PROVIDER_TASKS,
        "tasks": [],
        "slots": [
            {
                "slotNumber": slot_number,
                "taskIndex": task_index_for_slot(slot_number),
                "status": "pending",
            }
            for slot_number in range(1, TRACK_COUNT + 1)
        ],
        "lastKnownCredits": None,
        "updatedAt": now,
    }


def _json_value(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def normalize_generation_manifest(value: Any) -> dict[str, Any]:
    """Validate saved state and fill only fields that are safe to derive."""
    raw = _json_value(value)
    if raw is None:
        return create_generation_manifest()
    if not isinstance(raw, dict):
        raise GenerationError("generation_manifest must be a JSON object.")
    manifest = deepcopy(raw)
    if manifest.get("promptVersion") != PROMPT_VERSION:
        raise GenerationError(
            f"Unsupported prompt version: {manifest.get('promptVersion')!r}."
        )
    if manifest.get("provider") != PROVIDER_NAME:
        raise GenerationError(f"Unsupported provider: {manifest.get('provider')!r}.")
    if manifest.get("maxProviderTasks") != MAX_PROVIDER_TASKS:
        raise GenerationError("generation_manifest has an invalid provider task cap.")

    tasks = manifest.get("tasks")
    slots = manifest.get("slots")
    if not isinstance(tasks, list) or not isinstance(slots, list):
        raise GenerationError("generation_manifest tasks and slots must be arrays.")
    if len(tasks) > MAX_PROVIDER_TASKS:
        raise GenerationError("The saved provider task count exceeds the hard cap.")
    if len(slots) != TRACK_COUNT:
        raise GenerationError(f"generation_manifest must contain {TRACK_COUNT} slots.")

    allowed_task_statuses = {"submitting", "doing", "done", "error", "ambiguous"}
    seen_submission_indexes: set[int] = set()
    for expected_index, task in enumerate(tasks, start=1):
        if not isinstance(task, dict):
            raise GenerationError("Every generation task must be an object.")
        submission_index = task.get("submissionIndex")
        if submission_index != expected_index or submission_index in seen_submission_indexes:
            raise GenerationError("Generation task indexes must be contiguous and deterministic.")
        seen_submission_indexes.add(submission_index)
        task_index = _resolve_task_index(task, f"Task #{submission_index}")
        task["taskIndex"] = task_index
        task.pop("phase", None)
        if task.get("status") not in allowed_task_statuses:
            raise GenerationError(f"Task #{submission_index} has an invalid status.")
        if task.get("status") in {"doing", "done"} and not task.get("providerTaskId"):
            raise GenerationError(f"Task #{submission_index} is missing providerTaskId.")

    seen_slots: set[int] = set()
    for expected_slot, slot in enumerate(slots, start=1):
        if not isinstance(slot, dict):
            raise GenerationError("Every generation slot must be an object.")
        slot_number = slot.get("slotNumber")
        if slot_number != expected_slot or slot_number in seen_slots:
            raise GenerationError("Generation slots must be numbered 1 through 20.")
        seen_slots.add(slot_number)
        task_index = _resolve_task_index(slot, f"Slot #{slot_number}")
        expected_task_index = task_index_for_slot(slot_number)
        if task_index != expected_task_index:
            raise GenerationError(f"Slot #{slot_number} has an invalid taskIndex.")
        slot["taskIndex"] = task_index
        slot.pop("phase", None)
        if slot.get("status") not in {"pending", "downloaded"}:
            raise GenerationError(f"Slot #{slot_number} has an invalid status.")

    if manifest.get("lastKnownCredits") is not None and not isinstance(
        manifest.get("lastKnownCredits"), (int, float)
    ):
        raise GenerationError("lastKnownCredits must be numeric or null.")
    manifest["updatedAt"] = utc_now()
    return manifest


def downloaded_slots(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    return [slot for slot in manifest["slots"] if slot["status"] == "downloaded"]


def next_task_index_for_submission(manifest: dict[str, Any]) -> int | None:
    """Attempt task indexes 1-10 once, then top up the first missing pair."""
    attempted = {int(task["taskIndex"]) for task in manifest["tasks"]}
    for task_index in range(1, TRACK_COUNT // 2 + 1):
        if task_index not in attempted:
            return task_index
    active_task_indexes = {
        int(task["taskIndex"])
        for task in manifest["tasks"]
        if task["status"] in {"submitting", "doing"}
    }
    for slot in manifest["slots"]:
        if (
            slot["status"] == "pending"
            and int(slot["taskIndex"]) not in active_task_indexes
        ):
            return int(slot["taskIndex"])
    return None


def extract_provider_clips(payload: dict[str, Any]) -> tuple[ProviderClip, ...]:
    metadata = payload.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    candidates: list[ProviderClip] = []
    suno_result = metadata.get("suno_result")
    if isinstance(suno_result, dict):
        raw_clips = suno_result.get("clips")
        if isinstance(raw_clips, list):
            for clip in raw_clips:
                if not isinstance(clip, dict):
                    continue
                url = clip.get("audio_url")
                if isinstance(url, str) and url.strip():
                    clip_id = clip.get("id")
                    candidates.append(
                        ProviderClip(
                            url=url.strip(),
                            clip_id=str(clip_id) if clip_id is not None else None,
                        )
                    )
    all_audio_urls = metadata.get("all_audio_urls")
    if isinstance(all_audio_urls, list):
        candidates.extend(
            ProviderClip(url=url.strip())
            for url in all_audio_urls
            if isinstance(url, str) and url.strip()
        )
    audio_url = metadata.get("audio_url")
    if isinstance(audio_url, str) and audio_url.strip():
        candidates.append(ProviderClip(url=audio_url.strip()))

    result: list[ProviderClip] = []
    seen_urls: set[str] = set()
    for candidate in candidates:
        if candidate.url not in seen_urls:
            seen_urls.add(candidate.url)
            result.append(candidate)
    return tuple(result)


def parse_provider_task(payload: dict[str, Any]) -> ProviderTaskResult:
    status = str(payload.get("status") or "doing").lower()
    credit_cost = _optional_int(payload.get("credit_cost"))
    if status == "done":
        clips = extract_provider_clips(payload)
        if not clips:
            return ProviderTaskResult(
                status="error",
                error_message="Provider task completed without an audio URL.",
                credit_cost=credit_cost,
            )
        return ProviderTaskResult(status="done", clips=clips, credit_cost=credit_cost)
    if status in {"error", "failed", "cancelled", "canceled"}:
        return ProviderTaskResult(
            status="error",
            error_message=str(payload.get("error_message") or f"Provider status: {status}"),
            credit_cost=credit_cost,
        )
    return ProviderTaskResult(status="doing", credit_cost=credit_cost)


def _optional_int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return int(number)


def _load_env_local() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env.local"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key in {"DATABASE_URL", "STUDY_MEDIA_ROOT", "SUNO_API_KEY"} and not os.getenv(key):
            os.environ[key] = value


def _sanitize_dsn(dsn: str) -> str:
    parsed = urlparse(dsn)
    params = [
        (key, value)
        for key, value in parse_qsl(parsed.query)
        if key not in _ASYNCPG_UNSUPPORTED
    ]
    return urlunparse(parsed._replace(query=urlencode(params)))


def _database_url() -> str:
    _load_env_local()
    value = os.getenv("DATABASE_URL", "").strip()
    if not value:
        raise GenerationError("DATABASE_URL is not set in the environment or web_3/.env.local.")
    return _sanitize_dsn(value)


def _media_root() -> Path:
    _load_env_local()
    value = os.getenv("STUDY_MEDIA_ROOT", "").strip()
    return Path(value) if value else DEFAULT_STUDY_MEDIA_ROOT


def _api_key() -> str:
    _load_env_local()
    value = os.getenv("SUNO_API_KEY", "").strip()
    if not value:
        raise GenerationError("SUNO_API_KEY is not set in the environment or web_3/.env.local.")
    return value


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _probe_audio(path: Path) -> AudioProbe:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name,sample_rate,channels",
        "-of",
        "json",
        str(path),
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=True,
        )
    except FileNotFoundError as exc:
        raise GenerationError("ffprobe is required to validate generated tracks.") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or str(exc)).strip()
        raise GenerationError(f"ffprobe rejected {path.name}: {detail[-1000:]}") from exc
    try:
        payload = json.loads(result.stdout)
        duration_sec = float(payload.get("format", {}).get("duration"))
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise GenerationError(f"Cannot determine audio duration for {path.name}.") from exc
    if not math.isfinite(duration_sec) or duration_sec < MIN_TRACK_DURATION_SEC:
        raise GenerationError(
            f"Generated track {path.name} is shorter than {MIN_TRACK_DURATION_SEC:g} seconds."
        )
    audio = next(
        (
            stream
            for stream in payload.get("streams", [])
            if isinstance(stream, dict) and stream.get("codec_type") == "audio"
        ),
        None,
    )
    if audio is None:
        raise GenerationError(f"Generated track {path.name} has no audio stream.")
    codec_name = str(audio.get("codec_name") or "unknown")
    if codec_name.casefold() != "mp3":
        raise GenerationError(
            f"Generated track {path.name} must be MP3 audio, got {codec_name}."
        )
    return AudioProbe(
        sha256=_sha256_file(path),
        size_bytes=path.stat().st_size,
        duration_sec=duration_sec,
        codec_name=codec_name,
        sample_rate=_optional_int(audio.get("sample_rate")),
        channels=_optional_int(audio.get("channels")),
    )


class AI33Client:
    def __init__(self, api_key: str, base_url: str = AI33_BASE_URL, timeout_sec: float = 60.0):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec

    def _json_request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={
                "Content-Type": "application/json",
                "xi-api-key": self.api_key,
            },
        )
        try:
            with urlopen(request, timeout=self.timeout_sec) as response:
                raw = response.read()
        except HTTPError as exc:
            body_text = exc.read().decode("utf-8", errors="replace")
            if exc.code == 429:
                raise ProviderTransientError(f"AI33 HTTP 429: {body_text[-1000:]}") from exc
            if exc.code >= 500:
                if method == "POST":
                    raise AmbiguousSubmissionError(
                        f"AI33 submit returned HTTP {exc.code}; task creation is unknown."
                    ) from exc
                raise ProviderTransientError(
                    f"AI33 HTTP {exc.code}: {body_text[-1000:]}"
                ) from exc
            raise ProviderError(f"AI33 HTTP {exc.code}: {body_text[-1000:]}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            if method == "POST":
                raise AmbiguousSubmissionError(
                    "AI33 submit connection ended without a definitive response."
                ) from exc
            raise ProviderTransientError(f"AI33 network error: {exc}") from exc
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            if method == "POST":
                raise AmbiguousSubmissionError(
                    "AI33 submit returned invalid JSON; task creation is unknown."
                ) from exc
            raise ProviderTransientError("AI33 returned invalid JSON.") from exc
        if not isinstance(payload, dict):
            raise ProviderError("AI33 returned a non-object JSON response.")
        return payload

    def submit_task(self) -> tuple[str, int | None]:
        payload = self._json_request(
            "POST",
            "/v1s/task/music-generation",
            {
                "create_mode": "simple",
                "gpt_description_prompt": build_prompt(),
                "make_instrumental": True,
            },
        )
        task_id = payload.get("task_id")
        if not isinstance(task_id, str) or not task_id.strip():
            raise AmbiguousSubmissionError(
                "AI33 submit returned no task_id; task creation is unknown."
            )
        return task_id.strip(), _optional_int(payload.get("ec_remain_credits"))

    def poll_task(self, task_id: str) -> ProviderTaskResult:
        payload = self._json_request("GET", f"/v1/task/{task_id}")
        return parse_provider_task(payload)

    def download(self, url: str, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        last_error: Exception | None = None
        for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
            request = Request(url, headers={"User-Agent": "web_3-study-music/1.0"})
            try:
                with urlopen(request, timeout=self.timeout_sec) as response:
                    with destination.open("wb") as output:
                        while True:
                            chunk = response.read(1024 * 1024)
                            if not chunk:
                                break
                            output.write(chunk)
                if destination.stat().st_size <= 0:
                    raise OSError("Downloaded file is empty.")
                return
            except (HTTPError, URLError, TimeoutError, OSError) as exc:
                last_error = exc
                destination.unlink(missing_ok=True)
                if attempt < DOWNLOAD_ATTEMPTS:
                    time.sleep(min(2 ** (attempt - 1), MAX_BACKOFF_SEC))
        raise GenerationError(
            f"Could not download generated audio after {DOWNLOAD_ATTEMPTS} attempts: {last_error}"
        )


class DatabaseStore:
    async def _connect(self):
        try:
            import asyncpg
        except ImportError as exc:
            raise GenerationError("Missing dependency: pip install asyncpg") from exc
        return await asyncpg.connect(_database_url(), statement_cache_size=0, timeout=30)

    async def load(self, week_id: int) -> dict[str, Any]:
        conn = await self._connect()
        try:
            row = await conn.fetchrow(
                """
                SELECT id, week_number, status, generation_manifest, generation_run_id
                FROM study_audio_weeks
                WHERE id = $1
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
                    generation_heartbeat_at = NOW(),
                    error_message = $2,
                    updated_at = NOW()
                WHERE id = $3
                  AND generation_run_id = $4
                  AND status = 'generating'
                """,
                json.dumps(manifest),
                error_message,
                week_id,
                run_id,
            )
        finally:
            await conn.close()
        if result != "UPDATE 1":
            raise StaleGenerationError("This music generation run no longer owns the lease.")

    async def complete(
        self,
        week_id: int,
        run_id: str,
        manifest: dict[str, Any],
        track_manifest: dict[str, Any],
        total_duration_sec: int,
    ) -> None:
        manifest["updatedAt"] = utc_now()
        conn = await self._connect()
        try:
            result = await conn.execute(
                """
                UPDATE study_audio_weeks
                SET status = 'awaiting_rights',
                    generation_manifest = $1::jsonb,
                    track_manifest = $2::jsonb,
                    total_duration_sec = $3,
                    rights_verified_at = NULL,
                    error_message = NULL,
                    generation_heartbeat_at = NOW(),
                    generation_finished_at = NOW(),
                    updated_at = NOW()
                WHERE id = $4
                  AND generation_run_id = $5
                  AND status = 'generating'
                """,
                json.dumps(manifest),
                json.dumps(track_manifest),
                total_duration_sec,
                week_id,
                run_id,
            )
        finally:
            await conn.close()
        if result != "UPDATE 1":
            raise StaleGenerationError("This music generation run lost its lease before completion.")

    async def fail(
        self,
        week_id: int,
        run_id: str,
        manifest: dict[str, Any],
        error_message: str,
    ) -> None:
        manifest["updatedAt"] = utc_now()
        conn = await self._connect()
        try:
            result = await conn.execute(
                """
                UPDATE study_audio_weeks
                SET status = 'failed',
                    generation_manifest = $1::jsonb,
                    error_message = $2,
                    generation_heartbeat_at = NOW(),
                    generation_finished_at = NOW(),
                    updated_at = NOW()
                WHERE id = $3
                  AND generation_run_id = $4
                  AND status = 'generating'
                """,
                json.dumps(manifest),
                error_message[:4000],
                week_id,
                run_id,
            )
        finally:
            await conn.close()
        if result != "UPDATE 1":
            raise StaleGenerationError("This music generation run no longer owns the lease.")


SleepFunction = Callable[[float], Awaitable[None]]
ProbeFunction = Callable[[Path], AudioProbe]


class GenerationRunner:
    def __init__(
        self,
        store: Any,
        client: Any,
        media_root: Path,
        *,
        poll_interval_sec: float = POLL_INTERVAL_SEC,
        max_runtime_sec: float = MAX_RUNTIME_SEC,
        sleep: SleepFunction = asyncio.sleep,
        monotonic: Callable[[], float] = time.monotonic,
        probe_audio: ProbeFunction = _probe_audio,
    ) -> None:
        self.store = store
        self.client = client
        self.media_root = media_root.resolve()
        self.poll_interval_sec = poll_interval_sec
        self.max_runtime_sec = max_runtime_sec
        self.sleep = sleep
        self.monotonic = monotonic
        self.probe_audio = probe_audio
        self.deadline = 0.0
        self.poll_backoff: dict[int, float] = {}
        self.next_poll_at: dict[int, float] = {}

    async def run(self, week_id: int, run_id: str) -> Path:
        context = await self.store.load(week_id)
        if context.get("status") != "generating" or context.get("generation_run_id") != run_id:
            raise StaleGenerationError("The Generate API must claim this week before the worker runs.")
        week_number = int(context.get("week_number") or 0)
        if not 1 <= week_number <= 15:
            raise GenerationError(f"Invalid study week number: {week_number}")

        manifest = normalize_generation_manifest(context.get("generation_manifest"))
        week_dir = self.media_root / "audio" / f"week-{week_number:03d}"
        generation_dir = week_dir / "_generation"
        week_dir.mkdir(parents=True, exist_ok=True)
        generation_dir.mkdir(parents=True, exist_ok=True)
        self._recover_and_validate_files(manifest, week_dir, generation_dir)
        self._mark_interrupted_submissions_ambiguous(manifest)
        await self.store.save_progress(week_id, run_id, manifest)

        if any(task["status"] == "ambiguous" for task in manifest["tasks"]):
            raise AmbiguousSubmissionError(
                "A previous AI33 submission has an unknown outcome; refusing to spend more credits."
            )

        self.deadline = self.monotonic() + self.max_runtime_sec
        while len(downloaded_slots(manifest)) < TRACK_COUNT:
            self._assert_runtime()
            changed = await self._poll_tasks(
                week_id, run_id, manifest, week_dir, generation_dir
            )
            if changed:
                await self.store.save_progress(week_id, run_id, manifest)

            await self._fill_capacity(week_id, run_id, manifest)
            if len(downloaded_slots(manifest)) >= TRACK_COUNT:
                break

            doing = [task for task in manifest["tasks"] if task["status"] == "doing"]
            if not doing and len(manifest["tasks"]) >= MAX_PROVIDER_TASKS:
                raise GenerationError(
                    f"AI33 task cap reached with {len(downloaded_slots(manifest))}/{TRACK_COUNT} valid tracks."
                )
            if not doing and next_task_index_for_submission(manifest) is None:
                raise GenerationError("No safe provider work remains for the missing tracks.")

            await self.store.save_progress(week_id, run_id, manifest)
            await self.sleep(self.poll_interval_sec)

        self._recover_and_validate_files(manifest, week_dir, generation_dir)
        track_manifest = self._build_track_manifest(manifest)
        total_duration = int(round(sum(file["durationSec"] for file in track_manifest["files"])))
        await self.store.complete(
            week_id,
            run_id,
            manifest,
            track_manifest,
            total_duration,
        )
        print(f"Study audio week #{week_id} generated: {week_dir}")
        return week_dir

    def _assert_runtime(self) -> None:
        if self.monotonic() >= self.deadline:
            raise GenerationError("Music generation exceeded the 90-minute runtime limit.")

    @staticmethod
    def _mark_interrupted_submissions_ambiguous(manifest: dict[str, Any]) -> None:
        for task in manifest["tasks"]:
            if task["status"] == "submitting":
                task["status"] = "ambiguous"
                task["finishedAt"] = utc_now()
                task["errorMessage"] = (
                    "Worker stopped while submitting; provider task creation is unknown."
                )

    def _recover_and_validate_files(
        self,
        manifest: dict[str, Any],
        week_dir: Path,
        generation_dir: Path,
    ) -> None:
        managed_names = {
            str(slot.get("fileName"))
            for slot in downloaded_slots(manifest)
            if slot.get("fileName")
        }
        unknown_mp3s = sorted(
            path.name
            for path in week_dir.iterdir()
            if path.is_file() and path.suffix.casefold() == ".mp3" and path.name not in managed_names
        )
        if unknown_mp3s:
            raise GenerationError(
                "The week folder contains MP3 files not managed by this generation: "
                + ", ".join(unknown_mp3s)
            )

        seen_hashes: set[str] = set()
        for slot in manifest["slots"]:
            if slot["status"] != "downloaded":
                continue
            slot_number = int(slot["slotNumber"])
            expected_name = f"{slot_number:02d}.mp3"
            if slot.get("fileName") != expected_name:
                raise GenerationError(f"Downloaded slot #{slot_number} has an invalid file name.")
            final_path = week_dir / expected_name
            staged_path = generation_dir / f"slot-{slot_number:02d}.mp3.part"
            if not final_path.exists() and staged_path.exists():
                staged_hash = _sha256_file(staged_path)
                if staged_hash != slot.get("sha256"):
                    raise GenerationError(f"Staged file for slot #{slot_number} changed unexpectedly.")
                os.replace(staged_path, final_path)
            if not final_path.exists():
                slot.clear()
                slot.update(
                    {
                        "slotNumber": slot_number,
                        "taskIndex": task_index_for_slot(slot_number),
                        "status": "pending",
                    }
                )
                continue
            actual_hash = _sha256_file(final_path)
            if actual_hash != slot.get("sha256"):
                raise GenerationError(f"Generated file {expected_name} changed after download.")
            if actual_hash in seen_hashes:
                raise GenerationError(f"Duplicate generated checksum in {expected_name}.")
            seen_hashes.add(actual_hash)

    async def _poll_tasks(
        self,
        week_id: int,
        run_id: str,
        manifest: dict[str, Any],
        week_dir: Path,
        generation_dir: Path,
    ) -> bool:
        now = self.monotonic()
        doing = [
            task
            for task in manifest["tasks"]
            if task["status"] == "doing"
            and self.next_poll_at.get(int(task["submissionIndex"]), 0.0) <= now
        ]
        if not doing:
            return False
        results = await asyncio.gather(
            *[
                asyncio.to_thread(self.client.poll_task, str(task["providerTaskId"]))
                for task in doing
            ],
            return_exceptions=True,
        )
        changed = False
        for task, result in zip(doing, results):
            submission_index = int(task["submissionIndex"])
            if isinstance(result, ProviderTransientError):
                current = self.poll_backoff.get(submission_index, self.poll_interval_sec)
                self.poll_backoff[submission_index] = min(
                    max(self.poll_interval_sec, current * 2), MAX_BACKOFF_SEC
                )
                self.next_poll_at[submission_index] = (
                    now + self.poll_backoff[submission_index]
                )
                task["errorMessage"] = str(result)
                changed = True
                continue
            if isinstance(result, Exception):
                task["status"] = "error"
                task["finishedAt"] = utc_now()
                task["errorMessage"] = str(result)
                self.poll_backoff.pop(submission_index, None)
                self.next_poll_at.pop(submission_index, None)
                changed = True
                continue
            if not isinstance(result, ProviderTaskResult):
                task["status"] = "error"
                task["finishedAt"] = utc_now()
                task["errorMessage"] = "Provider client returned an invalid task result."
                self.poll_backoff.pop(submission_index, None)
                self.next_poll_at.pop(submission_index, None)
                changed = True
                continue
            if result.credit_cost is not None:
                task["creditCost"] = result.credit_cost
            if result.status == "doing":
                task.pop("errorMessage", None)
                self.poll_backoff[submission_index] = self.poll_interval_sec
                self.next_poll_at[submission_index] = now + self.poll_interval_sec
                continue
            if result.status == "error":
                task["status"] = "error"
                task["finishedAt"] = utc_now()
                task["errorMessage"] = result.error_message or "Provider task failed."
                self.poll_backoff.pop(submission_index, None)
                self.next_poll_at.pop(submission_index, None)
                changed = True
                continue

            try:
                task.pop("errorMessage", None)
                await self._download_task_clips(
                    week_id,
                    run_id,
                    manifest,
                    task,
                    result.clips,
                    week_dir,
                    generation_dir,
                )
                task["status"] = "done"
                task["finishedAt"] = utc_now()
            except Exception as exc:
                task["status"] = "error"
                task["finishedAt"] = utc_now()
                task["errorMessage"] = str(exc)[:2000]
            changed = True
            self.poll_backoff.pop(submission_index, None)
            self.next_poll_at.pop(submission_index, None)
        return changed

    async def _download_task_clips(
        self,
        week_id: int,
        run_id: str,
        manifest: dict[str, Any],
        task: dict[str, Any],
        clips: Sequence[ProviderClip],
        week_dir: Path,
        generation_dir: Path,
    ) -> None:
        task_index = int(task["taskIndex"])
        assigned_identities = {
            (slot.get("providerTaskId"), slot.get("providerClipId") or slot.get("sourceUrl"))
            for slot in downloaded_slots(manifest)
        }
        existing_hashes = {str(slot["sha256"]) for slot in downloaded_slots(manifest)}
        rejection_messages: list[str] = []
        for clip_index, clip in enumerate(clips, start=1):
            identity = (task.get("providerTaskId"), clip.clip_id or clip.url)
            if identity in assigned_identities:
                continue
            pending_slot = next(
                (
                    slot
                    for slot in manifest["slots"]
                    if int(slot["taskIndex"]) == task_index and slot["status"] == "pending"
                ),
                None,
            )
            if pending_slot is None:
                break
            slot_number = int(pending_slot["slotNumber"])
            staged_path = generation_dir / f"slot-{slot_number:02d}.mp3.part"
            staged_path.unlink(missing_ok=True)
            try:
                await asyncio.to_thread(self.client.download, clip.url, staged_path)
                probe = await asyncio.to_thread(self.probe_audio, staged_path)
            except Exception as exc:
                staged_path.unlink(missing_ok=True)
                rejection_messages.append(f"clip {clip_index}: {exc}")
                continue
            if probe.sha256 in existing_hashes:
                staged_path.unlink(missing_ok=True)
                rejection_messages.append(f"clip {clip_index}: duplicate checksum")
                continue

            file_name = f"{slot_number:02d}.mp3"
            relative_path = (week_dir / file_name).relative_to(self.media_root).as_posix()
            pending_slot.update(
                {
                    "status": "downloaded",
                    "fileName": file_name,
                    "relativePath": relative_path,
                    "sha256": probe.sha256,
                    "sizeBytes": probe.size_bytes,
                    "durationSec": probe.duration_sec,
                    "codecName": probe.codec_name,
                    "sampleRate": probe.sample_rate,
                    "channels": probe.channels,
                    "providerTaskId": task["providerTaskId"],
                    "providerClipId": clip.clip_id,
                    "sourceUrl": clip.url,
                }
            )
            await self.store.save_progress(week_id, run_id, manifest)
            final_path = week_dir / file_name
            if final_path.exists():
                raise GenerationError(f"Refusing to overwrite existing file: {file_name}")
            os.replace(staged_path, final_path)
            existing_hashes.add(probe.sha256)
            assigned_identities.add(identity)
        if rejection_messages:
            task["errorMessage"] = "; ".join(rejection_messages)[:2000]

    async def _fill_capacity(
        self,
        week_id: int,
        run_id: str,
        manifest: dict[str, Any],
    ) -> None:
        while (
            sum(task["status"] == "doing" for task in manifest["tasks"]) < MAX_IN_FLIGHT
            and len(manifest["tasks"]) < MAX_PROVIDER_TASKS
            and len(downloaded_slots(manifest)) < TRACK_COUNT
        ):
            task_index = next_task_index_for_submission(manifest)
            if task_index is None:
                return
            await self._submit_one(week_id, run_id, manifest, task_index)

    async def _submit_one(
        self,
        week_id: int,
        run_id: str,
        manifest: dict[str, Any],
        task_index: int,
    ) -> None:
        submission_index = len(manifest["tasks"]) + 1
        if submission_index > MAX_PROVIDER_TASKS:
            raise GenerationError("AI33 provider task cap reached.")
        task: dict[str, Any] = {
            "submissionIndex": submission_index,
            "taskIndex": task_index,
            "status": "submitting",
            "submittedAt": utc_now(),
        }
        manifest["tasks"].append(task)
        await self.store.save_progress(week_id, run_id, manifest)

        backoff = self.poll_interval_sec
        while True:
            self._assert_runtime()
            try:
                task_id, credits = await asyncio.to_thread(self.client.submit_task)
                task["providerTaskId"] = task_id
                task["status"] = "doing"
                task.pop("errorMessage", None)
                if credits is not None:
                    manifest["lastKnownCredits"] = credits
                await self.store.save_progress(week_id, run_id, manifest)
                return
            except ProviderTransientError as exc:
                task["errorMessage"] = str(exc)
                await self.store.save_progress(week_id, run_id, manifest, str(exc))
                await self.sleep(min(backoff, MAX_BACKOFF_SEC))
                backoff = min(max(self.poll_interval_sec, backoff * 2), MAX_BACKOFF_SEC)
            except AmbiguousSubmissionError as exc:
                task["status"] = "ambiguous"
                task["finishedAt"] = utc_now()
                task["errorMessage"] = str(exc)
                await self.store.save_progress(week_id, run_id, manifest, str(exc))
                raise
            except Exception as exc:
                task["status"] = "error"
                task["finishedAt"] = utc_now()
                task["errorMessage"] = str(exc)
                await self.store.save_progress(week_id, run_id, manifest, str(exc))
                return

    @staticmethod
    def _build_track_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
        slots = downloaded_slots(manifest)
        if len(slots) != TRACK_COUNT:
            raise GenerationError(f"Expected {TRACK_COUNT} downloaded slots, found {len(slots)}.")
        files = []
        for slot in sorted(slots, key=lambda item: int(item["slotNumber"])):
            files.append(
                {
                    "fileName": slot["fileName"],
                    "relativePath": slot["relativePath"],
                    "sha256": slot["sha256"],
                    "sizeBytes": slot["sizeBytes"],
                    "durationSec": slot["durationSec"],
                    "codecName": slot["codecName"],
                    "sampleRate": slot.get("sampleRate"),
                    "channels": slot.get("channels"),
                }
            )
        return {"files": files, "scannedAt": utc_now()}


async def run_with_failure_update(week_id: int, run_id: str) -> None:
    store = DatabaseStore()
    manifest: dict[str, Any] | None = None
    try:
        context = await store.load(week_id)
        manifest = normalize_generation_manifest(context.get("generation_manifest"))
        runner = GenerationRunner(store, AI33Client(_api_key()), _media_root())
        await runner.run(week_id, run_id)
    except StaleGenerationError as exc:
        print(f"StaleGenerationError: {exc}", file=sys.stderr)
        raise
    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"
        print(message, file=sys.stderr)
        if manifest is not None:
            try:
                latest = await store.load(week_id)
                manifest = normalize_generation_manifest(latest.get("generation_manifest"))
                await store.fail(week_id, run_id, manifest, message)
            except StaleGenerationError:
                pass
            except Exception as update_exc:
                print(f"Could not persist failed generation status: {update_exc}", file=sys.stderr)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate 20 Study With Me tracks through AI33.PRO.")
    parser.add_argument("week_id", type=int, help="study_audio_weeks.id")
    parser.add_argument("run_id", help="Generation lease id returned by the Generate API")
    args = parser.parse_args()
    try:
        asyncio.run(run_with_failure_update(args.week_id, args.run_id))
    except Exception:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
