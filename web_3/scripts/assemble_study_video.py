#!/usr/bin/env python3
"""Assemble one Study With Me daily video from local footage and weekly music."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

DEFAULT_STUDY_MEDIA_ROOT = Path(r"D:\VibeCoding\STUDY_WITH_ME")
DEFAULT_STUDY_OVERLAY_FONT = Path(r"C:\Windows\Fonts\consolab.ttf")
STUDY_OVERLAY_FONT_ENV = "STUDY_OVERLAY_FONT"
CROSSFADE_SEC = 3.0
FADE_SEC = 3.0
TARGET_WIDTH = 1920
TARGET_HEIGHT = 1080
TARGET_FPS = 30.0
ASPECT_RATIO_TOLERANCE = 0.02
MIN_FREE_SPACE_MULTIPLIER = 2.5
EXPECTED_TRACK_COUNT = 20
OUTPUT_DURATION_TOLERANCE_SEC = 2.0
LOUDNESS_TARGET_I = -16.0
LOUDNESS_TARGET_TP = -1.5
LOUDNESS_TARGET_LRA = 11.0
LOUDNESS_I_TOLERANCE = 1.0
STUDY_MASTER_PROFILE = "study-master-v1"
STUDY_ASSEMBLY_PROFILE = "study-pomodoro-v2"
POMODORO_FOCUS_SEC = 50 * 60
POMODORO_BREAK_SEC = 5 * 60
POMODORO_MARGIN_PX = 48
POMODORO_PADDING_PX = 18
POMODORO_FONT_SIZE = 42
POMODORO_FOCUS_COLOR = "0x67E8F9"
POMODORO_BREAK_COLOR = "0xF59E0B"
POMODORO_DUCK_GAIN = 10 ** (-4 / 20)
POMODORO_DUCK_DURATION_SEC = 2.0
POMODORO_BREAK_CHIME_GAP_SEC = 0.4
POMODORO_CHIME_DURATION_SEC = 1.2
POMODORO_CHIME_DECAY = 3.0
POMODORO_CHIME_FUNDAMENTAL_GAIN = 0.18
POMODORO_CHIME_HARMONIC_GAIN = 0.08
POMODORO_LIMITER_LEVEL = 10 ** (-2 / 20)
PREVIEW_DURATION_SEC = 90.0
PREVIEW_HEARTBEAT_SEC = 15.0
_ASYNCPG_UNSUPPORTED = {"channel_binding", "options"}
_ACTIVE_ATTEMPTS: dict[int, Any] = {}


class AssemblyError(RuntimeError):
    """Raised when input validation or media assembly fails."""


@dataclass(frozen=True)
class FootageInfo:
    path: Path
    relative_path: str
    sha256: str
    size_bytes: int
    duration_sec: float
    width: int
    height: int
    frame_rate: float
    codec_name: str
    has_audio: bool


@dataclass(frozen=True)
class FootageSlice:
    footage: FootageInfo
    source_offset_sec: float
    duration_sec: float


@dataclass(frozen=True)
class AudioTrackInfo:
    path: Path
    relative_path: str
    sha256: str
    size_bytes: int
    duration_sec: float
    codec_name: str
    sample_rate: int
    channels: int


@dataclass(frozen=True)
class OutputInfo:
    duration_sec: float
    width: int
    height: int
    frame_rate: float
    video_codec: str
    audio_codec: str


@dataclass(frozen=True)
class LoudnessMeasurement:
    integrated_lufs: float
    true_peak_dbtp: float
    loudness_range: float
    threshold: float
    target_offset: float


@dataclass(frozen=True)
class SilentMasterInfo:
    duration_sec: float
    width: int
    height: int
    frame_rate: float
    video_codec: str
    pixel_format: str


@dataclass(frozen=True)
class PomodoroCue:
    phase: str
    start_sec: float


def natural_sort_key(value: str | Path) -> tuple[Any, ...]:
    """Return a stable, case-insensitive key where numeric chunks sort numerically."""
    name = value.name if isinstance(value, Path) else value
    parts = tuple(
        (0, int(part)) if part.isdigit() else (1, part.lower())
        for part in re.split(r"(\d+)", name)
        if part
    )
    return parts, name.lower(), name


def week_number_for_day(day_number: int) -> int:
    if not 1 <= day_number <= 100:
        raise AssemblyError("day_number must be between 1 and 100.")
    return math.ceil(day_number / 7)


def is_supported_aspect_ratio(
    width: int,
    height: int,
    tolerance: float = ASPECT_RATIO_TOLERANCE,
) -> bool:
    if width <= 0 or height <= 0:
        return False
    target = 16 / 9
    return abs((width / height) - target) / target <= tolerance


def rotate_tracks(
    tracks: Sequence[AudioTrackInfo], day_number: int
) -> list[AudioTrackInfo]:
    if not tracks:
        raise AssemblyError("The weekly audio playlist is empty.")
    offset = (day_number - 1) % len(tracks)
    return list(tracks[offset:]) + list(tracks[:offset])


def build_audio_sequence(
    tracks: Sequence[AudioTrackInfo],
    day_number: int,
    target_duration_sec: float,
    crossfade_sec: float = CROSSFADE_SEC,
) -> list[AudioTrackInfo]:
    """Rotate and repeat a playlist until its crossfaded duration covers the video."""
    if target_duration_sec <= 0:
        raise AssemblyError("Target duration must be greater than zero.")
    if crossfade_sec < 0:
        raise AssemblyError("Crossfade duration cannot be negative.")

    ordered = rotate_tracks(tracks, day_number)
    for track in ordered:
        if track.duration_sec <= crossfade_sec:
            raise AssemblyError(
                f"Audio track {track.path.name} must be longer than the "
                f"{crossfade_sec:g}s crossfade."
            )

    sequence: list[AudioTrackInfo] = []
    effective_duration = 0.0
    index = 0
    while effective_duration + 1e-6 < target_duration_sec:
        track = ordered[index % len(ordered)]
        sequence.append(track)
        effective_duration += track.duration_sec - crossfade_sec
        index += 1
        if index > 10_000:
            raise AssemblyError("Audio playlist expansion exceeded the safety limit.")
    return sequence


def clamp_preview_window(
    requested_offset_sec: float,
    total_duration_sec: float,
    preview_duration_sec: float = PREVIEW_DURATION_SEC,
) -> tuple[float, float]:
    if not math.isfinite(requested_offset_sec) or requested_offset_sec < 0:
        raise AssemblyError("Preview offset must be a finite non-negative number.")
    if not math.isfinite(total_duration_sec) or total_duration_sec <= 0:
        raise AssemblyError("Preview source duration must be a finite positive number.")
    if not math.isfinite(preview_duration_sec) or preview_duration_sec <= 0:
        raise AssemblyError("Preview duration must be a finite positive number.")
    actual_offset = min(requested_offset_sec, max(0.0, total_duration_sec - preview_duration_sec))
    actual_duration = min(preview_duration_sec, total_duration_sec)
    return actual_offset, actual_duration


def select_preview_footage_slices(
    footage: Sequence[FootageInfo],
    start_sec: float,
    duration_sec: float,
) -> list[FootageSlice]:
    if not footage:
        raise AssemblyError("No footage was provided for the preview.")
    if not math.isfinite(start_sec) or start_sec < 0:
        raise AssemblyError("Preview start must be a finite non-negative number.")
    if not math.isfinite(duration_sec) or duration_sec <= 0:
        raise AssemblyError("Preview duration must be a finite positive number.")

    end_sec = start_sec + duration_sec
    cursor = 0.0
    slices: list[FootageSlice] = []
    for item in footage:
        item_start = cursor
        item_end = cursor + item.duration_sec
        overlap_start = max(start_sec, item_start)
        overlap_end = min(end_sec, item_end)
        if overlap_end > overlap_start + 1e-6:
            slices.append(
                FootageSlice(
                    footage=item,
                    source_offset_sec=overlap_start - item_start,
                    duration_sec=overlap_end - overlap_start,
                )
            )
        cursor = item_end
        if cursor >= end_sec:
            break
    if not slices:
        raise AssemblyError("The preview window does not intersect the footage.")
    covered = sum(item.duration_sec for item in slices)
    if abs(covered - duration_sec) > OUTPUT_DURATION_TOLERANCE_SEC:
        raise AssemblyError("The preview footage window is incomplete.")
    return slices


def pomodoro_state_at(
    elapsed_sec: float,
    focus_duration_sec: int = POMODORO_FOCUS_SEC,
    break_duration_sec: int = POMODORO_BREAK_SEC,
) -> tuple[str, int]:
    if elapsed_sec < 0 or not math.isfinite(elapsed_sec):
        raise AssemblyError("Pomodoro elapsed time must be a finite non-negative number.")
    if focus_duration_sec <= 0 or break_duration_sec <= 0:
        raise AssemblyError("Pomodoro phase durations must be greater than zero.")

    cycle_duration = focus_duration_sec + break_duration_sec
    cycle_position = elapsed_sec % cycle_duration
    if cycle_position < focus_duration_sec:
        return "FOCUS", math.ceil(focus_duration_sec - cycle_position)
    return "BREAK", math.ceil(cycle_duration - cycle_position)


def build_pomodoro_cue_schedule(
    target_duration_sec: float,
    focus_duration_sec: int = POMODORO_FOCUS_SEC,
    break_duration_sec: int = POMODORO_BREAK_SEC,
) -> list[PomodoroCue]:
    if target_duration_sec <= 0 or not math.isfinite(target_duration_sec):
        raise AssemblyError("Pomodoro target duration must be a finite positive number.")
    if focus_duration_sec <= 0 or break_duration_sec <= 0:
        raise AssemblyError("Pomodoro phase durations must be greater than zero.")

    cues: list[PomodoroCue] = []
    cycle_duration = focus_duration_sec + break_duration_sec
    cycle_start = 0.0
    while cycle_start < target_duration_sec:
        cues.append(PomodoroCue("FOCUS", cycle_start))
        break_start = cycle_start + focus_duration_sec
        if break_start < target_duration_sec:
            cues.append(PomodoroCue("BREAK", break_start))
            second_break_chime = break_start + POMODORO_BREAK_CHIME_GAP_SEC
            if second_break_chime < target_duration_sec:
                cues.append(PomodoroCue("BREAK", second_break_chime))
        cycle_start += cycle_duration
    return cues


def build_pomodoro_duck_windows(
    target_duration_sec: float,
    focus_duration_sec: int = POMODORO_FOCUS_SEC,
    break_duration_sec: int = POMODORO_BREAK_SEC,
) -> list[tuple[float, float]]:
    if target_duration_sec <= 0 or not math.isfinite(target_duration_sec):
        raise AssemblyError("Pomodoro target duration must be a finite positive number.")
    if focus_duration_sec <= 0 or break_duration_sec <= 0:
        raise AssemblyError("Pomodoro phase durations must be greater than zero.")

    cycle_duration = focus_duration_sec + break_duration_sec
    half_duck = POMODORO_DUCK_DURATION_SEC / 2
    transitions: list[float] = []
    cycle_start = 0.0
    while cycle_start < target_duration_sec:
        transitions.append(cycle_start)
        break_start = cycle_start + focus_duration_sec
        if break_start < target_duration_sec:
            transitions.append(break_start)
        cycle_start += cycle_duration

    windows: list[tuple[float, float]] = []
    for transition in transitions:
        if transition == 0:
            start = 0.0
            end = min(target_duration_sec, POMODORO_DUCK_DURATION_SEC)
        else:
            start = max(0.0, transition - half_duck)
            end = min(target_duration_sec, transition + half_duck)
        if end > start:
            windows.append((start, end))
    return windows


def compute_input_signature(
    day_number: int,
    week_number: int,
    footage_sha256s: Sequence[str],
    track_sha256s: Sequence[str],
    assembly_profile: str = STUDY_ASSEMBLY_PROFILE,
) -> str:
    payload = {
        "assemblyProfile": assembly_profile,
        "dayNumber": day_number,
        "weekNumber": week_number,
        "footageSha256s": list(footage_sha256s),
        "trackSha256s": list(track_sha256s),
    }
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def compute_master_signature(
    footage_sha256s: Sequence[str],
    master_profile: str = STUDY_MASTER_PROFILE,
) -> str:
    payload = {
        "masterProfile": master_profile,
        "footageSha256s": list(footage_sha256s),
    }
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def encoder_args(use_nvenc: bool) -> list[str]:
    if use_nvenc:
        return [
            "-c:v", "h264_nvenc",
            "-preset", "p5",
            "-cq", "20",
            "-b:v", "0",
            "-pix_fmt", "yuv420p",
        ]
    return [
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
    ]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


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
        if key in {"DATABASE_URL", "STUDY_MEDIA_ROOT", STUDY_OVERLAY_FONT_ENV} and not os.getenv(key):
            os.environ[key] = value


def _sanitize_dsn(dsn: str) -> str:
    parsed = urlparse(dsn)
    params = [(key, value) for key, value in parse_qsl(parsed.query) if key not in _ASYNCPG_UNSUPPORTED]
    return urlunparse(parsed._replace(query=urlencode(params)))


def _database_url() -> str:
    _load_env_local()
    value = os.getenv("DATABASE_URL", "").strip()
    if not value:
        raise AssemblyError("DATABASE_URL is not set in the environment or web_3/.env.local.")
    return _sanitize_dsn(value)


def _media_root() -> Path:
    _load_env_local()
    value = os.getenv("STUDY_MEDIA_ROOT", "").strip()
    return Path(value) if value else DEFAULT_STUDY_MEDIA_ROOT


def _json_value(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _run_json(command: list[str]) -> dict[str, Any]:
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
        raise AssemblyError(f"Required executable is not available: {command[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or str(exc)).strip()
        raise AssemblyError(f"Command failed: {detail[-2000:]}") from exc
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise AssemblyError(f"Invalid JSON returned by {command[0]}.") from exc


def _run_media_command(command: list[str], label: str) -> None:
    print(f"{label}...")
    try:
        subprocess.run(command, check=True)
    except FileNotFoundError as exc:
        raise AssemblyError(f"Required executable is not available: {command[0]}") from exc
    except subprocess.CalledProcessError as exc:
        raise AssemblyError(f"{label} failed with exit code {exc.returncode}.") from exc


def _run_media_capture(command: list[str], label: str) -> str:
    print(f"{label}...")
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as exc:
        raise AssemblyError(f"Required executable is not available: {command[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or str(exc)).strip()
        raise AssemblyError(f"{label} failed: {detail[-2000:]}") from exc
    return f"{result.stdout}\n{result.stderr}"


def _loudnorm_filter(
    *,
    measured: LoudnessMeasurement | None = None,
    print_format: str = "json",
) -> str:
    fields = [
        f"I={LOUDNESS_TARGET_I:g}",
        f"TP={LOUDNESS_TARGET_TP:g}",
        f"LRA={LOUDNESS_TARGET_LRA:g}",
    ]
    if measured is not None:
        fields.extend(
            [
                f"measured_I={measured.integrated_lufs:.6f}",
                f"measured_TP={measured.true_peak_dbtp:.6f}",
                f"measured_LRA={measured.loudness_range:.6f}",
                f"measured_thresh={measured.threshold:.6f}",
                f"offset={measured.target_offset:.6f}",
                "linear=true",
            ]
        )
    return f"loudnorm={':'.join(fields)}:print_format={print_format}"


def _parse_loudnorm_measurement(output: str) -> LoudnessMeasurement:
    candidates = re.findall(r"\{[^{}]*\}", output, flags=re.DOTALL)
    for candidate in reversed(candidates):
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        keys = ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")
        if not all(key in value for key in keys):
            continue
        try:
            measurement = LoudnessMeasurement(
                integrated_lufs=float(value["input_i"]),
                true_peak_dbtp=float(value["input_tp"]),
                loudness_range=float(value["input_lra"]),
                threshold=float(value["input_thresh"]),
                target_offset=float(value["target_offset"]),
            )
        except (TypeError, ValueError) as exc:
            raise AssemblyError("FFmpeg loudnorm returned non-finite measurements.") from exc
        if not all(math.isfinite(item) for item in (
            measurement.integrated_lufs,
            measurement.true_peak_dbtp,
            measurement.loudness_range,
            measurement.threshold,
            measurement.target_offset,
        )):
            raise AssemblyError("FFmpeg loudnorm returned non-finite measurements.")
        return measurement
    raise AssemblyError("FFmpeg loudnorm analysis did not return a JSON measurement.")


def _measure_loudness(path: Path) -> LoudnessMeasurement:
    output = _run_media_capture(
        [
            "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "info", "-nostats",
            "-i", str(path),
            "-map", "0:a:0",
            "-af", _loudnorm_filter(print_format="json"),
            "-f", "null", "-",
        ],
        f"Analyzing loudness for {path.name}",
    )
    return _parse_loudnorm_measurement(output)


def _normalize_track(source: AudioTrackInfo, destination: Path) -> AudioTrackInfo:
    measured = _measure_loudness(source.path)
    _run_media_command(
        [
            "ffmpeg", "-y", "-hide_banner", "-nostdin", "-loglevel", "warning", "-stats",
            "-i", str(source.path),
            "-map", "0:a:0",
            "-af", _loudnorm_filter(measured=measured, print_format="summary"),
            "-ar", "48000", "-ac", "2",
            "-c:a", "flac",
            str(destination),
        ],
        f"Normalizing track {source.path.name}",
    )
    probe = _probe(destination)
    return AudioTrackInfo(
        path=destination,
        relative_path=source.relative_path,
        sha256=source.sha256,
        size_bytes=destination.stat().st_size,
        duration_sec=_duration(probe, destination),
        codec_name="flac",
        sample_rate=48000,
        channels=2,
    )


def _normalize_sequence(
    sequence: Sequence[AudioTrackInfo],
    temp_dir: Path,
) -> list[AudioTrackInfo]:
    temp_dir.mkdir(parents=True, exist_ok=True)
    cache: dict[str, AudioTrackInfo] = {}
    normalized: list[AudioTrackInfo] = []
    for source in sequence:
        item = cache.get(source.sha256)
        if item is None:
            destination = temp_dir / f"normalized-{len(cache) + 1:02d}-{source.sha256[:12]}.flac"
            item = _normalize_track(source, destination)
            cache[source.sha256] = item
        normalized.append(item)
    return normalized


def _validate_final_loudness(path: Path) -> LoudnessMeasurement:
    measurement = _measure_loudness(path)
    if abs(measurement.integrated_lufs - LOUDNESS_TARGET_I) > LOUDNESS_I_TOLERANCE:
        raise AssemblyError(
            f"Final integrated loudness is {measurement.integrated_lufs:.2f} LUFS; "
            f"expected {LOUDNESS_TARGET_I:g} +/- {LOUDNESS_I_TOLERANCE:g}."
        )
    if measurement.true_peak_dbtp > LOUDNESS_TARGET_TP:
        raise AssemblyError(
            f"Final true peak is {measurement.true_peak_dbtp:.2f} dBTP; "
            f"must be <= {LOUDNESS_TARGET_TP:g} dBTP."
        )
    return measurement


def _probe(path: Path) -> dict[str, Any]:
    return _run_json(
        [
            "ffprobe", "-v", "error",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,r_frame_rate,sample_rate,channels",
            "-of", "json",
            str(path),
        ]
    )


def _duration(probe: dict[str, Any], path: Path) -> float:
    try:
        duration = float(probe.get("format", {}).get("duration"))
    except (TypeError, ValueError) as exc:
        raise AssemblyError(f"Cannot determine duration for {path.name}.") from exc
    if not math.isfinite(duration) or duration <= 0:
        raise AssemblyError(f"Invalid duration for {path.name}: {duration!r}.")
    return duration


def _frame_rate(value: str | None) -> float:
    if not value:
        return 0.0
    numerator, separator, denominator = value.partition("/")
    try:
        if separator:
            divisor = float(denominator)
            return float(numerator) / divisor if divisor else 0.0
        return float(numerator)
    except ValueError:
        return 0.0


def _regular_files_with_extension(directory: Path, extension: str) -> list[Path]:
    if not directory.is_dir():
        raise AssemblyError(f"Required directory does not exist: {directory}")
    regular_files = [path for path in directory.iterdir() if path.is_file()]
    invalid = [path.name for path in regular_files if path.suffix.casefold() != extension]
    if invalid:
        raise AssemblyError(
            f"Only {extension} files are allowed in {directory}; found: {', '.join(sorted(invalid))}"
        )
    files = sorted(regular_files, key=natural_sort_key)
    if not files:
        raise AssemblyError(f"No {extension} files found in {directory}.")
    return files


def scan_footage(directory: Path, media_root: Path) -> list[FootageInfo]:
    result: list[FootageInfo] = []
    for path in _regular_files_with_extension(directory, ".mp4"):
        probe = _probe(path)
        streams = probe.get("streams", [])
        video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
        if video is None:
            raise AssemblyError(f"Footage file has no video stream: {path.name}")
        width = int(video.get("width") or 0)
        height = int(video.get("height") or 0)
        if not is_supported_aspect_ratio(width, height):
            raise AssemblyError(
                f"Footage must be horizontal 16:9 (+/-2%): {path.name} is {width}x{height}."
            )
        frame_rate = _frame_rate(video.get("avg_frame_rate") or video.get("r_frame_rate"))
        if frame_rate <= 0:
            raise AssemblyError(f"Cannot determine frame rate for {path.name}.")
        result.append(
            FootageInfo(
                path=path,
                relative_path=path.relative_to(media_root).as_posix(),
                sha256=_sha256_file(path),
                size_bytes=path.stat().st_size,
                duration_sec=_duration(probe, path),
                width=width,
                height=height,
                frame_rate=frame_rate,
                codec_name=str(video.get("codec_name") or "unknown"),
                has_audio=any(stream.get("codec_type") == "audio" for stream in streams),
            )
        )
    return result


def scan_audio_tracks(directory: Path, media_root: Path) -> list[AudioTrackInfo]:
    files = _regular_files_with_extension(directory, ".mp3")
    if len(files) != EXPECTED_TRACK_COUNT:
        raise AssemblyError(
            f"Weekly audio must contain exactly {EXPECTED_TRACK_COUNT} MP3 files; found {len(files)}."
        )
    result: list[AudioTrackInfo] = []
    for path in files:
        probe = _probe(path)
        audio = next(
            (stream for stream in probe.get("streams", []) if stream.get("codec_type") == "audio"),
            None,
        )
        if audio is None:
            raise AssemblyError(f"Audio track has no audio stream: {path.name}")
        sample_rate = int(audio.get("sample_rate") or 0)
        channels = int(audio.get("channels") or 0)
        if sample_rate <= 0 or channels <= 0:
            raise AssemblyError(f"Invalid audio stream in {path.name}.")
        result.append(
            AudioTrackInfo(
                path=path,
                relative_path=path.relative_to(media_root).as_posix(),
                sha256=_sha256_file(path),
                size_bytes=path.stat().st_size,
                duration_sec=_duration(probe, path),
                codec_name=str(audio.get("codec_name") or "unknown"),
                sample_rate=sample_rate,
                channels=channels,
            )
        )
    return result


def footage_manifest(files: Sequence[FootageInfo]) -> dict[str, Any]:
    return {
        "files": [
            {
                "fileName": item.path.name,
                "relativePath": item.relative_path,
                "sha256": item.sha256,
                "sizeBytes": item.size_bytes,
                "durationSec": item.duration_sec,
                "width": item.width,
                "height": item.height,
                "frameRate": item.frame_rate,
                "codecName": item.codec_name,
                "hasAudio": item.has_audio,
            }
            for item in files
        ],
        "scannedAt": _utc_now(),
    }


def _manifest_identity(manifest: Any) -> list[tuple[str, str]]:
    value = _json_value(manifest) or {}
    files = value.get("files") if isinstance(value, dict) else None
    if not isinstance(files, list):
        return []
    identity: list[tuple[str, str]] = []
    for item in files:
        if not isinstance(item, dict):
            return []
        relative_path = item.get("relativePath")
        sha256 = item.get("sha256")
        if not isinstance(relative_path, str) or not isinstance(sha256, str):
            return []
        identity.append((relative_path, sha256))
    return identity


def _assert_unique_current_footage(files: Sequence[FootageInfo]) -> None:
    seen: dict[str, str] = {}
    for item in files:
        previous = seen.get(item.sha256)
        if previous is not None:
            raise AssemblyError(
                f"Duplicate footage in the current day: {previous} and {item.path.name}."
            )
        seen[item.sha256] = item.path.name


def _assert_disk_space(output_dir: Path, source_size: int) -> None:
    required = math.ceil(source_size * MIN_FREE_SPACE_MULTIPLIER)
    free = shutil.disk_usage(output_dir).free
    if free < required:
        raise AssemblyError(
            f"Insufficient free disk space: need at least {required} bytes, have {free} bytes."
        )


def nvenc_runtime_available() -> bool:
    command = [
        "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.1",
        "-frames:v", "1", "-c:v", "h264_nvenc", "-f", "null", "-",
    ]
    try:
        result = subprocess.run(command, capture_output=True, timeout=30, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def _resolve_timer_font() -> Path:
    _load_env_local()
    configured = os.getenv(STUDY_OVERLAY_FONT_ENV, "").strip()
    font_path = Path(configured) if configured else DEFAULT_STUDY_OVERLAY_FONT
    if not font_path.is_absolute() or not font_path.is_file():
        raise AssemblyError(
            f"{STUDY_OVERLAY_FONT_ENV} must be an absolute path to an existing font file: "
            f"{font_path}"
        )
    return font_path.resolve()


def _escape_filter_path(path: Path) -> str:
    return str(path).replace("\\", "/").replace(":", r"\:").replace("'", r"\'")


def _timeline_value(timeline_offset_sec: float) -> str:
    if not math.isfinite(timeline_offset_sec) or timeline_offset_sec < 0:
        raise AssemblyError("Timeline offset must be a finite non-negative number.")
    return "t" if timeline_offset_sec == 0 else f"(t+{timeline_offset_sec:.6f})"


def _countdown_text(
    phase: str,
    phase_end_sec: int,
    cycle_duration_sec: int,
    timeline_offset_sec: float = 0.0,
) -> str:
    position = f"floor(mod({_timeline_value(timeline_offset_sec)}\\,{cycle_duration_sec:g}))"
    remaining = f"{phase_end_sec:g}-{position}"
    return (
        f"{phase} %{{eif\\:floor(({remaining})/60)\\:d\\:2}}"
        f"\\:%{{eif\\:mod({remaining}\\,60)\\:d\\:2}}"
    )


def _drawtext_filter(
    color: str,
    enable: str,
    text: str,
    font_path: Path,
) -> str:
    margin = POMODORO_MARGIN_PX
    padding = POMODORO_PADDING_PX
    return (
        "drawtext="
        f"fontfile='{_escape_filter_path(font_path)}':"
        f"fontsize={POMODORO_FONT_SIZE}:fontcolor={color}:"
        "box=1:boxcolor=black@0.65:"
        f"boxborderw={padding}:x=w-tw-{margin}-{padding}:y=h-th-{margin}-{padding}:"
        f"enable='{enable}':text='{text}'"
    )


def _normalized_video_filter(
    footage_count: int,
    output_label: str = "outv",
) -> str:
    if footage_count <= 0:
        raise AssemblyError("At least one footage input is required.")

    parts: list[str] = []
    labels: list[str] = []
    for index in range(footage_count):
        label = f"v{index}"
        parts.append(
            f"[{index}:v:0]"
            f"scale={TARGET_WIDTH}:{TARGET_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,"
            f"pad={TARGET_WIDTH}:{TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,"
            f"fps={TARGET_FPS:g},setsar=1,settb=AVTB,setpts=PTS-STARTPTS[{label}]"
        )
        labels.append(f"[{label}]")
    parts.append(f"{''.join(labels)}concat=n={footage_count}:v=1:a=0[{output_label}]")
    return ";".join(parts)


def _pomodoro_video_filter(
    input_label: str = "0:v:0",
    output_label: str = "outv",
    focus_duration_sec: int = POMODORO_FOCUS_SEC,
    break_duration_sec: int = POMODORO_BREAK_SEC,
    font_path: Path | None = None,
    timeline_offset_sec: float = 0.0,
) -> str:
    if focus_duration_sec <= 0 or break_duration_sec <= 0:
        raise AssemblyError("Pomodoro phase durations must be greater than zero.")

    cycle_duration_sec = focus_duration_sec + break_duration_sec
    font = font_path or _resolve_timer_font()
    timeline = _timeline_value(timeline_offset_sec)
    focus_enable = f"lt(mod({timeline}\\,{cycle_duration_sec:g})\\,{focus_duration_sec:g})"
    break_enable = f"gte(mod({timeline}\\,{cycle_duration_sec:g})\\,{focus_duration_sec:g})"
    focus_drawtext = _drawtext_filter(
        POMODORO_FOCUS_COLOR,
        focus_enable,
        _countdown_text("FOCUS", focus_duration_sec, cycle_duration_sec, timeline_offset_sec),
        font,
    )
    break_drawtext = _drawtext_filter(
        POMODORO_BREAK_COLOR,
        break_enable,
        _countdown_text("BREAK", cycle_duration_sec, cycle_duration_sec, timeline_offset_sec),
        font,
    )
    return (
        f"[{input_label}]setpts=PTS-STARTPTS,{focus_drawtext}[focus_timer];"
        f"[focus_timer]{break_drawtext}[{output_label}]"
    )


def _video_filter(
    footage_count: int,
    focus_duration_sec: int = POMODORO_FOCUS_SEC,
    break_duration_sec: int = POMODORO_BREAK_SEC,
    font_path: Path | None = None,
) -> str:
    normalized = _normalized_video_filter(footage_count, "normalized_video")
    timer = _pomodoro_video_filter(
        "normalized_video",
        "outv",
        focus_duration_sec,
        break_duration_sec,
        font_path,
    )
    return f"{normalized};{timer}"


def _render_silent_master(
    footage: Sequence[FootageInfo],
    destination: Path,
    use_nvenc: bool,
) -> None:
    command = ["ffmpeg", "-y", "-hide_banner", "-nostdin", "-loglevel", "warning", "-stats"]
    for item in footage:
        command += ["-i", str(item.path)]
    command += [
        "-filter_complex", _normalized_video_filter(len(footage)),
        "-map", "[outv]", "-an",
        *encoder_args(use_nvenc),
        "-movflags", "+faststart",
        str(destination),
    ]
    try:
        _run_media_command(command, "Building silent footage master")
    except AssemblyError:
        if not use_nvenc:
            raise
        destination.unlink(missing_ok=True)
        print("NVENC master render failed; retrying with libx264.")
        _render_silent_master(
            footage,
            destination,
            use_nvenc=False,
        )


def _chime_expression(phase: str) -> str:
    if phase == "FOCUS":
        fundamental_hz, harmonic_hz = 880, 1320
    elif phase == "BREAK":
        fundamental_hz, harmonic_hz = 660, 990
    else:
        raise AssemblyError(f"Unsupported Pomodoro phase: {phase}.")
    return (
        f"{POMODORO_CHIME_FUNDAMENTAL_GAIN:g}*sin(2*PI*{fundamental_hz}*t)*"
        f"exp(-{POMODORO_CHIME_DECAY:g}*t)+"
        f"{POMODORO_CHIME_HARMONIC_GAIN:g}*sin(2*PI*{harmonic_hz}*t)*"
        f"exp(-{POMODORO_CHIME_DECAY:g}*t)"
    )


def _audio_filter(
    sequence_count: int,
    timeline_end_sec: float,
    crossfade_sec: float,
    focus_duration_sec: int = POMODORO_FOCUS_SEC,
    break_duration_sec: int = POMODORO_BREAK_SEC,
    *,
    timeline_start_sec: float = 0.0,
    output_duration_sec: float | None = None,
    full_duration_sec: float | None = None,
) -> str:
    if sequence_count <= 0:
        raise AssemblyError("At least one audio track is required.")
    if not math.isfinite(timeline_start_sec) or timeline_start_sec < 0:
        raise AssemblyError("Audio timeline start must be a finite non-negative number.")
    if not math.isfinite(timeline_end_sec) or timeline_end_sec <= timeline_start_sec:
        raise AssemblyError("Audio timeline end must be greater than its start.")
    output_duration = output_duration_sec or (timeline_end_sec - timeline_start_sec)
    full_duration = full_duration_sec or timeline_end_sec
    if output_duration <= 0 or full_duration < timeline_end_sec:
        raise AssemblyError("Audio preview duration is invalid.")

    parts: list[str] = []
    for index in range(sequence_count):
        parts.append(
            f"[{index}:a:0]aresample=48000,"
            f"aformat=sample_fmts=fltp:channel_layouts=stereo,"
            f"asetpts=PTS-STARTPTS[t{index}]"
        )

    current = "[t0]"
    if sequence_count == 1:
        parts.append(f"{current}anull[music]")
    else:
        for index in range(1, sequence_count):
            output = "[music]" if index == sequence_count - 1 else f"[mix{index}]"
            parts.append(
                f"{current}[t{index}]acrossfade=d={crossfade_sec:g}:c1=tri:c2=tri{output}"
            )
            current = output

    fade = min(FADE_SEC, full_duration / 2)
    fade_out_start = max(0.0, full_duration - fade)
    parts.append(
        "[music]"
        f"afade=t=in:st=0:d={fade:.6f},"
        f"afade=t=out:st={fade_out_start:.6f}:d={fade:.6f},"
        "asetpts=PTS-STARTPTS[musicbase]"
    )
    duck_windows = build_pomodoro_duck_windows(
        timeline_end_sec,
        focus_duration_sec,
        break_duration_sec,
    )
    duck_condition = "+".join(
        f"between(t\\,{start:.6f}\\,{end:.6f})" for start, end in duck_windows
    )
    parts.append(
        f"[musicbase]volume=volume={POMODORO_DUCK_GAIN:.6f}:eval=frame:"
        f"enable='{duck_condition}'[musicduck]"
    )

    cues = build_pomodoro_cue_schedule(
        timeline_end_sec,
        focus_duration_sec,
        break_duration_sec,
    )
    cue_labels: list[str] = []
    for index, cue in enumerate(cues):
        expression = _chime_expression(cue.phase)
        delay_ms = round(cue.start_sec * 1000)
        label = f"[cue{index}]"
        parts.append(
            f"aevalsrc=exprs='{expression}|{expression}':s=48000:"
            f"d={POMODORO_CHIME_DURATION_SEC:g}:c=stereo,"
            f"adelay={delay_ms}|{delay_ms}{label}"
        )
        cue_labels.append(label)
    parts.append(
        f"{''.join(cue_labels)}amix=inputs={len(cue_labels)}:duration=longest:"
        "dropout_transition=0:normalize=0[cues]"
    )
    parts.append(
        "[musicduck][cues]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,"
        f"alimiter=limit={POMODORO_LIMITER_LEVEL:.6f}:level=false:latency=true,"
        f"atrim=start={timeline_start_sec:.6f}:end={timeline_end_sec:.6f},"
        "asetpts=PTS-STARTPTS[outa]"
    )
    return ";".join(parts)


def _render_audio(
    sequence: Sequence[AudioTrackInfo],
    destination: Path,
    timeline_end_sec: float,
    crossfade_sec: float,
    focus_duration_sec: int = POMODORO_FOCUS_SEC,
    break_duration_sec: int = POMODORO_BREAK_SEC,
    *,
    timeline_start_sec: float = 0.0,
    output_duration_sec: float | None = None,
    full_duration_sec: float | None = None,
) -> None:
    output_duration = output_duration_sec or (timeline_end_sec - timeline_start_sec)
    command = ["ffmpeg", "-y", "-hide_banner", "-nostdin", "-loglevel", "warning", "-stats"]
    for item in sequence:
        command += ["-i", str(item.path)]
    command += [
        "-filter_complex",
        _audio_filter(
            len(sequence),
            timeline_end_sec,
            crossfade_sec,
            focus_duration_sec,
            break_duration_sec,
            timeline_start_sec=timeline_start_sec,
            output_duration_sec=output_duration,
            full_duration_sec=full_duration_sec,
        ),
        "-map", "[outa]",
        "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2",
        "-t", f"{output_duration:.6f}",
        str(destination),
    ]
    _run_media_command(command, "Building weekly audio playlist")


def _render_final_from_master(
    master: Path,
    audio: Path,
    destination: Path,
    duration_sec: float,
    use_nvenc: bool,
    focus_duration_sec: int = POMODORO_FOCUS_SEC,
    break_duration_sec: int = POMODORO_BREAK_SEC,
) -> None:
    command = [
        "ffmpeg", "-y", "-hide_banner", "-nostdin", "-loglevel", "warning", "-stats",
        "-i", str(master), "-i", str(audio),
        "-filter_complex",
        _pomodoro_video_filter(
            focus_duration_sec=focus_duration_sec,
            break_duration_sec=break_duration_sec,
        ),
        "-map", "[outv]", "-map", "1:a:0",
        *encoder_args(use_nvenc),
        "-c:a", "copy",
        "-t", f"{duration_sec:.6f}", "-shortest",
        "-movflags", "+faststart",
        str(destination),
    ]
    try:
        _run_media_command(command, "Rendering Pomodoro overlay and final Study video")
    except AssemblyError:
        if not use_nvenc:
            raise
        destination.unlink(missing_ok=True)
        print("NVENC final render failed; retrying with libx264.")
        _render_final_from_master(
            master,
            audio,
            destination,
            duration_sec,
            use_nvenc=False,
            focus_duration_sec=focus_duration_sec,
            break_duration_sec=break_duration_sec,
        )


def _render_preview_video_from_master(
    master: Path,
    destination: Path,
    start_sec: float,
    duration_sec: float,
    use_nvenc: bool,
    focus_duration_sec: int = POMODORO_FOCUS_SEC,
    break_duration_sec: int = POMODORO_BREAK_SEC,
) -> None:
    command = [
        "ffmpeg", "-y", "-hide_banner", "-nostdin", "-loglevel", "warning", "-stats",
        "-ss", f"{start_sec:.6f}", "-t", f"{duration_sec:.6f}", "-i", str(master),
        "-filter_complex",
        _pomodoro_video_filter(
            focus_duration_sec=focus_duration_sec,
            break_duration_sec=break_duration_sec,
            timeline_offset_sec=start_sec,
        ),
        "-map", "[outv]", "-an",
        *encoder_args(use_nvenc),
        "-t", f"{duration_sec:.6f}",
        "-movflags", "+faststart",
        str(destination),
    ]
    try:
        _run_media_command(command, "Rendering preview video from silent master")
    except AssemblyError:
        if not use_nvenc:
            raise
        destination.unlink(missing_ok=True)
        print("NVENC preview render failed; retrying with libx264.")
        _render_preview_video_from_master(
            master,
            destination,
            start_sec,
            duration_sec,
            use_nvenc=False,
            focus_duration_sec=focus_duration_sec,
            break_duration_sec=break_duration_sec,
        )


def _render_preview_video_from_footage(
    slices: Sequence[FootageSlice],
    destination: Path,
    timeline_start_sec: float,
    duration_sec: float,
    use_nvenc: bool,
    focus_duration_sec: int = POMODORO_FOCUS_SEC,
    break_duration_sec: int = POMODORO_BREAK_SEC,
) -> None:
    if not slices:
        raise AssemblyError("At least one footage slice is required for a preview.")
    command = ["ffmpeg", "-y", "-hide_banner", "-nostdin", "-loglevel", "warning", "-stats"]
    for item in slices:
        command += [
            "-ss", f"{item.source_offset_sec:.6f}",
            "-t", f"{item.duration_sec:.6f}",
            "-i", str(item.footage.path),
        ]
    normalized = _normalized_video_filter(len(slices), "preview_normalized")
    timer = _pomodoro_video_filter(
        "preview_normalized",
        "outv",
        focus_duration_sec,
        break_duration_sec,
        timeline_offset_sec=timeline_start_sec,
    )
    command += [
        "-filter_complex", f"{normalized};{timer}",
        "-map", "[outv]", "-an",
        *encoder_args(use_nvenc),
        "-t", f"{duration_sec:.6f}",
        "-movflags", "+faststart",
        str(destination),
    ]
    try:
        _run_media_command(command, "Rendering preview video from footage window")
    except AssemblyError:
        if not use_nvenc:
            raise
        destination.unlink(missing_ok=True)
        print("NVENC preview render failed; retrying with libx264.")
        _render_preview_video_from_footage(
            slices,
            destination,
            timeline_start_sec,
            duration_sec,
            use_nvenc=False,
            focus_duration_sec=focus_duration_sec,
            break_duration_sec=break_duration_sec,
        )


def _mux_preview(video: Path, audio: Path, destination: Path, duration_sec: float) -> None:
    command = [
        "ffmpeg", "-y", "-hide_banner", "-nostdin", "-loglevel", "warning", "-stats",
        "-i", str(video), "-i", str(audio),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "copy",
        "-t", f"{duration_sec:.6f}",
        "-movflags", "+faststart",
        str(destination),
    ]
    _run_media_command(command, "Muxing Study preview")


def render_preview_media(
    footage: Sequence[FootageInfo],
    tracks: Sequence[AudioTrackInfo],
    day_number: int,
    destination: Path,
    total_duration_sec: float,
    timeline_start_sec: float,
    preview_duration_sec: float,
    *,
    master_path: Path | None = None,
    crossfade_sec: float = CROSSFADE_SEC,
    prefer_nvenc: bool = True,
    pomodoro_focus_sec: int = POMODORO_FOCUS_SEC,
    pomodoro_break_sec: int = POMODORO_BREAK_SEC,
) -> OutputInfo:
    if len(tracks) != EXPECTED_TRACK_COUNT:
        raise AssemblyError(f"Expected {EXPECTED_TRACK_COUNT} audio tracks, got {len(tracks)}.")
    timeline_end = timeline_start_sec + preview_duration_sec
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(tempfile.mkdtemp(prefix=".preview-", dir=destination.parent))
    preview_video = temp_dir / "preview_video.mp4"
    preview_audio = temp_dir / "preview_audio.m4a"
    temporary_final = temp_dir / "preview.mp4"
    try:
        use_nvenc = prefer_nvenc and nvenc_runtime_available()
        if master_path is not None:
            _render_preview_video_from_master(
                master_path,
                preview_video,
                timeline_start_sec,
                preview_duration_sec,
                use_nvenc,
                pomodoro_focus_sec,
                pomodoro_break_sec,
            )
        else:
            slices = select_preview_footage_slices(
                footage,
                timeline_start_sec,
                preview_duration_sec,
            )
            _render_preview_video_from_footage(
                slices,
                preview_video,
                timeline_start_sec,
                preview_duration_sec,
                use_nvenc,
                pomodoro_focus_sec,
                pomodoro_break_sec,
            )
        normalized_tracks = _normalize_sequence(tracks, temp_dir)
        sequence = build_audio_sequence(
            normalized_tracks,
            day_number,
            timeline_end,
            crossfade_sec,
        )
        _render_audio(
            sequence,
            preview_audio,
            timeline_end,
            crossfade_sec,
            pomodoro_focus_sec,
            pomodoro_break_sec,
            timeline_start_sec=timeline_start_sec,
            output_duration_sec=preview_duration_sec,
            full_duration_sec=total_duration_sec,
        )
        _mux_preview(preview_video, preview_audio, temporary_final, preview_duration_sec)
        output = probe_output(temporary_final)
        _validate_output(output, preview_duration_sec)
        _validate_final_loudness(temporary_final)
        os.replace(temporary_final, destination)
        return output
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def probe_silent_master(path: Path) -> SilentMasterInfo:
    probe = _probe(path)
    streams = probe.get("streams", [])
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]
    audios = [stream for stream in streams if stream.get("codec_type") == "audio"]
    if len(videos) != 1 or audios:
        raise AssemblyError("Silent master must contain exactly one video stream and no audio.")
    video = videos[0]
    return SilentMasterInfo(
        duration_sec=_duration(probe, path),
        width=int(video.get("width") or 0),
        height=int(video.get("height") or 0),
        frame_rate=_frame_rate(video.get("avg_frame_rate") or video.get("r_frame_rate")),
        video_codec=str(video.get("codec_name") or ""),
        pixel_format=str(video.get("pix_fmt") or ""),
    )


def _validate_silent_master(master: SilentMasterInfo, expected_duration_sec: float) -> None:
    if master.width != TARGET_WIDTH or master.height != TARGET_HEIGHT:
        raise AssemblyError(
            f"Unexpected silent master resolution: {master.width}x{master.height}."
        )
    if abs(master.frame_rate - TARGET_FPS) > 0.01:
        raise AssemblyError(
            f"Unexpected silent master frame rate: {master.frame_rate:g} fps."
        )
    if master.video_codec != "h264" or master.pixel_format != "yuv420p":
        raise AssemblyError(
            "Unexpected silent master format: "
            f"codec={master.video_codec}, pixel_format={master.pixel_format}."
        )
    difference = abs(master.duration_sec - expected_duration_sec)
    if difference > OUTPUT_DURATION_TOLERANCE_SEC:
        raise AssemblyError(
            f"Silent master duration differs from source by {difference:.3f}s "
            f"(allowed {OUTPUT_DURATION_TOLERANCE_SEC:g}s)."
        )


def probe_output(path: Path) -> OutputInfo:
    probe = _probe(path)
    streams = probe.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    if video is None or audio is None:
        raise AssemblyError("Final output must contain one video stream and one audio stream.")
    return OutputInfo(
        duration_sec=_duration(probe, path),
        width=int(video.get("width") or 0),
        height=int(video.get("height") or 0),
        frame_rate=_frame_rate(video.get("avg_frame_rate") or video.get("r_frame_rate")),
        video_codec=str(video.get("codec_name") or ""),
        audio_codec=str(audio.get("codec_name") or ""),
    )


def _validate_output(output: OutputInfo, expected_duration_sec: float) -> None:
    if output.width != TARGET_WIDTH or output.height != TARGET_HEIGHT:
        raise AssemblyError(
            f"Unexpected output resolution: {output.width}x{output.height}."
        )
    if abs(output.frame_rate - TARGET_FPS) > 0.01:
        raise AssemblyError(f"Unexpected output frame rate: {output.frame_rate:g} fps.")
    if output.video_codec != "h264" or output.audio_codec != "aac":
        raise AssemblyError(
            f"Unexpected output codecs: video={output.video_codec}, audio={output.audio_codec}."
        )
    difference = abs(output.duration_sec - expected_duration_sec)
    if difference > OUTPUT_DURATION_TOLERANCE_SEC:
        raise AssemblyError(
            f"Output duration differs from source by {difference:.3f}s "
            f"(allowed {OUTPUT_DURATION_TOLERANCE_SEC:g}s)."
        )


def assemble_from_master(
    master_path: Path,
    tracks: Sequence[AudioTrackInfo],
    day_number: int,
    final_path: Path,
    target_duration_sec: float,
    *,
    crossfade_sec: float = CROSSFADE_SEC,
    prefer_nvenc: bool = True,
    pomodoro_focus_sec: int = POMODORO_FOCUS_SEC,
    pomodoro_break_sec: int = POMODORO_BREAK_SEC,
) -> OutputInfo:
    if len(tracks) != EXPECTED_TRACK_COUNT:
        raise AssemblyError(f"Expected {EXPECTED_TRACK_COUNT} audio tracks, got {len(tracks)}.")
    _validate_silent_master(probe_silent_master(master_path), target_duration_sec)

    final_path.parent.mkdir(parents=True, exist_ok=True)

    temp_dir = Path(tempfile.mkdtemp(prefix=".assembly-", dir=final_path.parent))
    assembled_audio = temp_dir / "assembled_audio.m4a"
    temporary_final = temp_dir / "final_video.mp4"
    try:
        use_nvenc = prefer_nvenc and nvenc_runtime_available()
        print(f"Video encoder: {'h264_nvenc' if use_nvenc else 'libx264'}")
        normalized_tracks = _normalize_sequence(tracks, temp_dir)
        sequence = build_audio_sequence(
            normalized_tracks,
            day_number,
            target_duration_sec,
            crossfade_sec,
        )
        _render_audio(
            sequence,
            assembled_audio,
            target_duration_sec,
            crossfade_sec,
            pomodoro_focus_sec,
            pomodoro_break_sec,
        )
        _render_final_from_master(
            master_path,
            assembled_audio,
            temporary_final,
            target_duration_sec,
            use_nvenc,
            pomodoro_focus_sec,
            pomodoro_break_sec,
        )
        output = probe_output(temporary_final)
        _validate_output(output, target_duration_sec)
        _validate_final_loudness(temporary_final)
        os.replace(temporary_final, final_path)
        return output
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def assemble_media(
    footage: Sequence[FootageInfo],
    tracks: Sequence[AudioTrackInfo],
    day_number: int,
    final_path: Path,
    *,
    crossfade_sec: float = CROSSFADE_SEC,
    prefer_nvenc: bool = True,
    check_disk: bool = True,
    pomodoro_focus_sec: int = POMODORO_FOCUS_SEC,
    pomodoro_break_sec: int = POMODORO_BREAK_SEC,
) -> OutputInfo:
    if not footage:
        raise AssemblyError("No footage was provided.")
    target_duration = sum(item.duration_sec for item in footage)
    final_path.parent.mkdir(parents=True, exist_ok=True)
    if check_disk:
        _assert_disk_space(final_path.parent, sum(item.size_bytes for item in footage))

    temp_dir = Path(tempfile.mkdtemp(prefix=".master-", dir=final_path.parent))
    master_path = temp_dir / "master_silent.mp4"
    try:
        use_nvenc = prefer_nvenc and nvenc_runtime_available()
        _render_silent_master(footage, master_path, use_nvenc)
        _validate_silent_master(probe_silent_master(master_path), target_duration)
        return assemble_from_master(
            master_path,
            tracks,
            day_number,
            final_path,
            target_duration,
            crossfade_sec=crossfade_sec,
            prefer_nvenc=prefer_nvenc,
            pomodoro_focus_sec=pomodoro_focus_sec,
            pomodoro_break_sec=pomodoro_break_sec,
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


async def _connect():
    try:
        import asyncpg
    except ImportError as exc:
        raise AssemblyError("Missing dependency: pip install asyncpg") from exc
    return await asyncpg.connect(_database_url(), statement_cache_size=0, timeout=30)


async def _load_video_context(video_id: int) -> dict[str, Any]:
    conn = await _connect()
    try:
        row = await conn.fetchrow(
            """
            SELECT
                v.id,
                v.day_number,
                v.week_id,
                v.status,
                v.footage_manifest,
                v.input_signature,
                v.master_signature,
                v.master_path,
                v.master_created_at,
                v.assembly_started_at,
                v.preview_status,
                v.preview_run_id,
                v.preview_heartbeat_at,
                v.preview_requested_offset_sec,
                v.preview_actual_offset_sec,
                w.week_number,
                w.status AS week_status,
                w.track_manifest,
                w.rights_verified_at
            FROM study_daily_videos v
            LEFT JOIN study_audio_weeks w ON w.id = v.week_id
            WHERE v.id = $1
            """,
            video_id,
        )
    finally:
        await conn.close()
    if row is None:
        raise AssemblyError(f"Study daily video #{video_id} was not found.")
    return dict(row)


async def _mark_master_ready(
    video_id: int,
    master_signature: str,
    master_relative_path: str,
    master_created_at: Any,
    assembly_started_at: Any,
    candidate_path: Path,
    master_path: Path,
) -> None:
    conn = await _connect()
    try:
        async with conn.transaction():
            owner = await conn.fetchrow(
                """
                SELECT status, assembly_started_at
                FROM study_daily_videos
                WHERE id = $1
                FOR UPDATE
                """,
                video_id,
            )
            if (
                owner is None
                or owner["status"] != "assembling"
                or owner["assembly_started_at"] != assembly_started_at
            ):
                raise AssemblyError(
                    "This assembly attempt is stale and cannot update the footage master."
                )

            os.replace(candidate_path, master_path)
            result = await conn.execute(
                """
                UPDATE study_daily_videos
                SET master_signature = $1,
                    master_path = $2,
                    master_created_at = $3,
                    updated_at = NOW()
                WHERE id = $4
                  AND status = 'assembling'
                  AND assembly_started_at = $5
                """,
                master_signature,
                master_relative_path,
                master_created_at,
                video_id,
                assembly_started_at,
            )
            if result != "UPDATE 1":
                raise AssemblyError(
                    "This assembly attempt lost its lease while saving the footage master."
                )
    finally:
        await conn.close()


async def _used_footage_hashes(video_id: int) -> dict[str, tuple[int, int]]:
    conn = await _connect()
    try:
        rows = await conn.fetch(
            """
            SELECT id, day_number, footage_manifest
            FROM study_daily_videos
            WHERE id <> $1 AND footage_manifest IS NOT NULL
            """,
            video_id,
        )
    finally:
        await conn.close()
    result: dict[str, tuple[int, int]] = {}
    for row in rows:
        manifest = _json_value(row["footage_manifest"]) or {}
        for item in manifest.get("files", []) if isinstance(manifest, dict) else []:
            if isinstance(item, dict) and isinstance(item.get("sha256"), str):
                result[item["sha256"]] = (int(row["id"]), int(row["day_number"]))
    return result


async def _mark_done(
    video_id: int,
    manifest: dict[str, Any],
    duration_sec: float,
    input_signature: str,
    final_video_path: str,
    assembly_started_at: Any,
    attempt_path: Path,
    final_path: Path,
) -> None:
    conn = await _connect()
    try:
        async with conn.transaction():
            owner = await conn.fetchrow(
                """
                SELECT status, assembly_started_at
                FROM study_daily_videos
                WHERE id = $1
                FOR UPDATE
                """,
                video_id,
            )
            if (
                owner is None
                or owner["status"] != "assembling"
                or owner["assembly_started_at"] != assembly_started_at
            ):
                raise AssemblyError(
                    "This assembly attempt is stale and cannot overwrite a newer retry."
                )

            # Hold the row lock across the atomic file promotion so a retry cannot
            # acquire the DB lease between the ownership check and os.replace().
            os.replace(attempt_path, final_path)
            result = await conn.execute(
                """
                UPDATE study_daily_videos
                SET status = 'done',
                    footage_manifest = $1::jsonb,
                    duration_sec = $2,
                    input_signature = $3,
                    final_video_path = $4,
                    error_message = NULL,
                    assembly_finished_at = NOW(),
                    updated_at = NOW()
                WHERE id = $5
                  AND status = 'assembling'
                  AND assembly_started_at = $6
                """,
                json.dumps(manifest),
                duration_sec,
                input_signature,
                final_video_path,
                video_id,
                assembly_started_at,
            )
            if result != "UPDATE 1":
                raise AssemblyError(
                    "This assembly attempt lost its lease while finalizing."
                )
    finally:
        await conn.close()


async def _mark_failed(video_id: int, message: str, assembly_started_at: Any) -> None:
    conn = await _connect()
    try:
        result = await conn.execute(
            """
            UPDATE study_daily_videos
            SET status = 'failed',
                error_message = $1,
                assembly_finished_at = NOW(),
                updated_at = NOW()
            WHERE id = $2
              AND status = 'assembling'
              AND assembly_started_at = $3
            """,
            message[:4000],
            video_id,
            assembly_started_at,
        )
    finally:
        await conn.close()
    if result != "UPDATE 1":
        raise AssemblyError(
            "Could not mark the assembly failed because its lease is no longer current."
        )


async def _touch_preview_heartbeat(video_id: int, run_id: str) -> None:
    conn = await _connect()
    try:
        result = await conn.execute(
            """
            UPDATE study_daily_videos
            SET preview_heartbeat_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
              AND preview_status = 'rendering'
              AND preview_run_id = $2
            """,
            video_id,
            run_id,
        )
    finally:
        await conn.close()
    if result != "UPDATE 1":
        raise AssemblyError("This preview worker lost its lease.")


async def _preview_heartbeat_loop(
    video_id: int,
    run_id: str,
    stop_event: asyncio.Event,
) -> None:
    while True:
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=PREVIEW_HEARTBEAT_SEC)
            return
        except TimeoutError:
            await _touch_preview_heartbeat(video_id, run_id)


async def _mark_preview_done(
    video_id: int,
    run_id: str,
    attempt_path: Path,
    preview_path: Path,
) -> None:
    conn = await _connect()
    backup_path = preview_path.parent / f".preview-backup-{uuid.uuid4().hex}.mp4"
    promoted = False
    had_previous = preview_path.is_file()
    try:
        async with conn.transaction():
            owner = await conn.fetchrow(
                """
                SELECT preview_status, preview_run_id
                FROM study_daily_videos
                WHERE id = $1
                FOR UPDATE
                """,
                video_id,
            )
            if (
                owner is None
                or owner["preview_status"] != "rendering"
                or owner["preview_run_id"] != run_id
            ):
                raise AssemblyError(
                    "This preview attempt is stale and cannot overwrite a newer preview."
                )

            if had_previous:
                shutil.copy2(preview_path, backup_path)
            os.replace(attempt_path, preview_path)
            promoted = True
            result = await conn.execute(
                """
                UPDATE study_daily_videos
                SET preview_status = 'done',
                    preview_error_message = NULL,
                    preview_finished_at = NOW(),
                    preview_heartbeat_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1
                  AND preview_status = 'rendering'
                  AND preview_run_id = $2
                """,
                video_id,
                run_id,
            )
            if result != "UPDATE 1":
                raise AssemblyError("This preview attempt lost its lease while finalizing.")
    except Exception:
        if promoted:
            if had_previous and backup_path.is_file():
                os.replace(backup_path, preview_path)
            else:
                preview_path.unlink(missing_ok=True)
        raise
    finally:
        backup_path.unlink(missing_ok=True)
        await conn.close()


async def _mark_preview_failed(video_id: int, run_id: str, message: str) -> None:
    conn = await _connect()
    try:
        result = await conn.execute(
            """
            UPDATE study_daily_videos
            SET preview_status = 'failed',
                preview_error_message = $1,
                preview_finished_at = NOW(),
                updated_at = NOW()
            WHERE id = $2
              AND preview_status = 'rendering'
              AND preview_run_id = $3
            """,
            message[:4000],
            video_id,
            run_id,
        )
    finally:
        await conn.close()
    if result != "UPDATE 1":
        raise AssemblyError("Could not mark the preview failed because its lease is no longer current.")


async def _ensure_silent_master(
    video_id: int,
    context: dict[str, Any],
    footage: Sequence[FootageInfo],
    master_path: Path,
    master_relative_path: str,
    target_duration_sec: float,
    assembly_started_at: Any,
) -> Path:
    master_signature = compute_master_signature([item.sha256 for item in footage])
    cached_path = context.get("master_path")
    if (
        context.get("master_signature") == master_signature
        and cached_path == master_relative_path
        and master_path.is_file()
    ):
        try:
            _validate_silent_master(probe_silent_master(master_path), target_duration_sec)
            print(f"Reusing silent footage master: {master_path}")
            return master_path
        except AssemblyError as exc:
            print(f"Silent master cache invalid; rebuilding: {exc}")

    # Only touch the server-derived path. Never trust a persisted path for file operations.
    master_path.unlink(missing_ok=True)
    master_path.parent.mkdir(parents=True, exist_ok=True)
    candidate_path = master_path.parent / f".master_silent-{uuid.uuid4().hex}.mp4"
    try:
        use_nvenc = nvenc_runtime_available()
        print(f"Master video encoder: {'h264_nvenc' if use_nvenc else 'libx264'}")
        _render_silent_master(footage, candidate_path, use_nvenc)
        _validate_silent_master(probe_silent_master(candidate_path), target_duration_sec)
        await _mark_master_ready(
            video_id,
            master_signature,
            master_relative_path,
            datetime.now(timezone.utc),
            assembly_started_at,
            candidate_path,
            master_path,
        )
        return master_path
    finally:
        candidate_path.unlink(missing_ok=True)


def _find_valid_cached_master(
    context: dict[str, Any],
    footage: Sequence[FootageInfo],
    master_path: Path,
    master_relative_path: str,
    target_duration_sec: float,
) -> Path | None:
    expected_signature = compute_master_signature([item.sha256 for item in footage])
    if (
        context.get("master_signature") != expected_signature
        or context.get("master_path") != master_relative_path
        or not master_path.is_file()
    ):
        return None
    try:
        _validate_silent_master(probe_silent_master(master_path), target_duration_sec)
    except AssemblyError as exc:
        print(f"Silent master is unavailable for preview: {exc}")
        return None
    print(f"Reusing silent footage master for preview: {master_path}")
    return master_path


async def preview_video_id(video_id: int, run_id: str) -> Path:
    context = await _load_video_context(video_id)
    if context.get("preview_status") != "rendering" or context.get("preview_run_id") != run_id:
        raise AssemblyError("The preview must be claimed by the Preview API before rendering.")

    day_number = int(context["day_number"])
    week_number = int(context["week_number"] or 0)
    expected_week = week_number_for_day(day_number)
    if week_number != expected_week:
        raise AssemblyError(f"Day {day_number} must use week {expected_week}, not week {week_number}.")
    if context["week_status"] != "ready":
        raise AssemblyError(f"Audio week {week_number} is not ready.")
    if context["rights_verified_at"] is None:
        raise AssemblyError(f"Commercial rights for audio week {week_number} are not verified.")
    _resolve_timer_font()

    requested_offset = float(context.get("preview_requested_offset_sec") or 0.0)
    claimed_actual_offset = float(context.get("preview_actual_offset_sec") or 0.0)
    media_root = _media_root().resolve()
    day_root = media_root / "daily" / f"day-{day_number:03d}"
    source_dir = day_root / "source"
    audio_dir = media_root / "audio" / f"week-{week_number:03d}"
    work_dir = day_root / "work"
    output_dir = day_root / "output"
    master_path = work_dir / "master_silent.mp4"
    preview_path = output_dir / "preview.mp4"
    attempt_path = output_dir / f".preview-{uuid.uuid4().hex}.mp4"
    work_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    footage = scan_footage(source_dir, media_root)
    _assert_unique_current_footage(footage)
    tracks = scan_audio_tracks(audio_dir, media_root)
    saved_track_identity = _manifest_identity(context["track_manifest"])
    current_track_identity = [(item.relative_path, item.sha256) for item in tracks]
    if saved_track_identity != current_track_identity:
        raise AssemblyError(f"Audio week {week_number} changed after its last scan; scan the week again.")

    total_duration = sum(item.duration_sec for item in footage)
    actual_offset, preview_duration = clamp_preview_window(requested_offset, total_duration)
    if abs(actual_offset - claimed_actual_offset) > 0.001:
        raise AssemblyError("Footage duration changed after the preview request; request the preview again.")
    master_relative_path = master_path.relative_to(media_root).as_posix()
    cached_master = _find_valid_cached_master(
        context,
        footage,
        master_path,
        master_relative_path,
        total_duration,
    )

    stop_heartbeat = asyncio.Event()
    heartbeat_task = asyncio.create_task(
        _preview_heartbeat_loop(video_id, run_id, stop_heartbeat)
    )
    try:
        await asyncio.to_thread(
            render_preview_media,
            footage,
            tracks,
            day_number,
            attempt_path,
            total_duration,
            actual_offset,
            preview_duration,
            master_path=cached_master,
        )
        stop_heartbeat.set()
        await heartbeat_task
        await _mark_preview_done(video_id, run_id, attempt_path, preview_path)
    finally:
        stop_heartbeat.set()
        if not heartbeat_task.done():
            await asyncio.gather(heartbeat_task, return_exceptions=True)
        attempt_path.unlink(missing_ok=True)
    print(f"Study preview #{video_id} done: {preview_path}")
    return preview_path


async def assemble_video_id(video_id: int) -> Path:
    context = await _load_video_context(video_id)
    if context["status"] == "assembling" and context["assembly_started_at"] is not None:
        _ACTIVE_ATTEMPTS[video_id] = context["assembly_started_at"]
    day_number = int(context["day_number"])
    week_number = int(context["week_number"] or 0)
    expected_week = week_number_for_day(day_number)
    if week_number != expected_week:
        raise AssemblyError(
            f"Day {day_number} must use week {expected_week}, not week {week_number}."
        )
    if context["week_status"] != "ready":
        raise AssemblyError(f"Audio week {week_number} is not ready.")
    if context["rights_verified_at"] is None:
        raise AssemblyError(f"Commercial rights for audio week {week_number} are not verified.")
    if context["status"] != "assembling" or context["assembly_started_at"] is None:
        raise AssemblyError(
            "The video must be claimed by the Assemble API before running the media worker."
        )
    _resolve_timer_font()

    assembly_started_at = context["assembly_started_at"]
    media_root = _media_root().resolve()
    source_dir = media_root / "daily" / f"day-{day_number:03d}" / "source"
    audio_dir = media_root / "audio" / f"week-{week_number:03d}"
    work_dir = media_root / "daily" / f"day-{day_number:03d}" / "work"
    output_dir = media_root / "daily" / f"day-{day_number:03d}" / "output"
    master_path = work_dir / "master_silent.mp4"
    final_path = output_dir / "final_video.mp4"
    attempt_path = output_dir / f".final_video-{uuid.uuid4().hex}.mp4"
    work_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    footage = scan_footage(source_dir, media_root)
    _assert_unique_current_footage(footage)
    tracks = scan_audio_tracks(audio_dir, media_root)

    saved_track_identity = _manifest_identity(context["track_manifest"])
    current_track_identity = [(item.relative_path, item.sha256) for item in tracks]
    if saved_track_identity != current_track_identity:
        raise AssemblyError(
            f"Audio week {week_number} changed after its last scan; scan the week again."
        )

    saved_footage_identity = _manifest_identity(context["footage_manifest"])
    current_footage_identity = [(item.relative_path, item.sha256) for item in footage]
    if saved_footage_identity != current_footage_identity:
        raise AssemblyError(
            f"Day {day_number} footage changed after the assembly request was claimed; retry assembly."
        )

    used_hashes = await _used_footage_hashes(video_id)
    for item in footage:
        duplicate = used_hashes.get(item.sha256)
        if duplicate:
            other_id, other_day = duplicate
            raise AssemblyError(
                f"Footage {item.path.name} was already used by day {other_day} "
                f"(video #{other_id})."
            )

    manifest = footage_manifest(footage)
    signature = compute_input_signature(
        day_number,
        week_number,
        [item.sha256 for item in footage],
        [item.sha256 for item in tracks],
    )
    if context["input_signature"] != signature:
        raise AssemblyError(
            "The claimed input signature does not match the current footage and audio manifests."
        )
    target_duration = sum(item.duration_sec for item in footage)
    _assert_disk_space(output_dir, sum(item.size_bytes for item in footage))
    master_relative_path = master_path.relative_to(media_root).as_posix()
    try:
        await _ensure_silent_master(
            video_id,
            context,
            footage,
            master_path,
            master_relative_path,
            target_duration,
            assembly_started_at,
        )
        output = assemble_from_master(
            master_path,
            tracks,
            day_number,
            attempt_path,
            target_duration,
        )
        relative_output = final_path.relative_to(media_root).as_posix()
        await _mark_done(
            video_id,
            manifest,
            int(round(output.duration_sec)),
            signature,
            relative_output,
            assembly_started_at,
            attempt_path,
            final_path,
        )
    finally:
        attempt_path.unlink(missing_ok=True)
    _ACTIVE_ATTEMPTS.pop(video_id, None)
    print(f"Study video #{video_id} done: {final_path}")
    return final_path


async def _run_with_failure_update(video_id: int) -> None:
    try:
        await assemble_video_id(video_id)
    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"
        print(message, file=sys.stderr)
        attempt = _ACTIVE_ATTEMPTS.pop(video_id, None)
        if attempt is not None:
            try:
                await _mark_failed(video_id, message, attempt)
            except Exception as update_exc:
                print(f"Could not persist failed status: {update_exc}", file=sys.stderr)
        raise


async def _run_preview_with_failure_update(video_id: int, run_id: str) -> None:
    try:
        await preview_video_id(video_id, run_id)
    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"
        print(message, file=sys.stderr)
        try:
            await _mark_preview_failed(video_id, run_id, message)
        except Exception as update_exc:
            print(f"Could not persist failed preview status: {update_exc}", file=sys.stderr)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Assemble one Study With Me daily video.")
    parser.add_argument("video_id", type=int, help="study_daily_videos.id")
    parser.add_argument("--preview-run-id", help="Render the claimed 90-second preview instead")
    args = parser.parse_args()
    try:
        if args.preview_run_id:
            asyncio.run(_run_preview_with_failure_update(args.video_id, args.preview_run_id))
        else:
            asyncio.run(_run_with_failure_update(args.video_id))
    except Exception:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
