#!/usr/bin/env python3
"""Local, lease-based render worker for the web video pipeline."""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import io
import json
import logging
import os
import signal
import shutil
import sys
import threading
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from auto_yt.paths import PROJECT_ROOT
from auto_yt.render import assemble as asm
from auto_yt.render import chapters as chapter_tools
from auto_yt.render import subtitles as subs
from auto_yt.services.render_db import (
    claim_render_video,
    claim_specific_render,
    list_rendered_exports,
    mark_render_failed,
    owns_render_lease,
    save_render_done,
    save_resolved_description,
    save_whisper_transcript,
    touch_render_heartbeat,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 30
HEARTBEAT_INTERVAL_SECONDS = 30
WEB_ENV_PATH = PROJECT_ROOT / "web" / ".env.local"
STOP_REQUESTED = threading.Event()
IMAGE_ROOT = Path(
    os.getenv(
        "RENDER_IMAGE_ROOT",
        str(PROJECT_ROOT / "web" / "data" / "character-images"),
    )
)
OUTPUT_ROOT = Path(
    os.getenv(
        "RENDER_OUTPUT_ROOT",
        str(PROJECT_ROOT / "web" / "data" / "renders"),
    )
)


def _load_web_env() -> None:
    if not WEB_ENV_PATH.exists():
        return
    for raw_line in WEB_ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.lstrip("\ufeff").strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def load_database_url() -> str:
    _load_web_env()
    dsn = os.getenv("DATABASE_URL", "").strip()
    if not dsn:
        raise RuntimeError(f"Missing DATABASE_URL in environment or {WEB_ENV_PATH}")
    return dsn


def load_openai_key() -> str:
    _load_web_env()
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError(f"Missing OPENAI_API_KEY in environment or {WEB_ENV_PATH}")
    return key


def request_stop(signum: int | None = None, _frame: object | None = None) -> None:
    if not STOP_REQUESTED.is_set():
        logger.info("Render worker stop requested%s", f" by signal {signum}" if signum else "")
    STOP_REQUESTED.set()


async def wait_for_operation(operation):
    task = asyncio.ensure_future(operation)
    try:
        while not task.done():
            if STOP_REQUESTED.is_set():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
                raise InterruptedError("Render worker stop requested")
            await asyncio.wait({task}, timeout=1)
        return await task
    finally:
        if not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


def promote_files(
    replacements: list[tuple[Path, Path]],
    backup_dir: Path,
) -> tuple[list[tuple[Path, Path]], list[Path]]:
    """Promote validated files and keep rollback copies until the DB commit."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    backups: list[tuple[Path, Path]] = []
    promoted: list[Path] = []
    try:
        for source, target in replacements:
            if not source.exists():
                continue
            backup = backup_dir / f"{target.name}.previous"
            backup.unlink(missing_ok=True)
            if target.exists():
                os.replace(target, backup)
                backups.append((target, backup))
            os.replace(source, target)
            promoted.append(target)
    except Exception:
        rollback_promoted_files(backups, promoted)
        raise
    return backups, promoted


def rollback_promoted_files(
    backups: list[tuple[Path, Path]],
    promoted: list[Path],
) -> None:
    for target in reversed(promoted):
        target.unlink(missing_ok=True)
    for target, backup in reversed(backups):
        if backup.exists():
            os.replace(backup, target)


def discard_promotion_backups(backups: list[tuple[Path, Path]]) -> None:
    for _, backup in backups:
        try:
            backup.unlink(missing_ok=True)
        except OSError:
            logger.warning("Could not remove render promotion backup: %s", backup)


async def get_config_float(
    dsn: str,
    key: str,
    fallback: float,
    *,
    minimum: float,
    maximum: float,
) -> float:
    from auto_yt.services.job_queue import _connect

    conn = await _connect(dsn)
    try:
        raw = await conn.fetchval("SELECT value FROM channel_config WHERE key = $1", key)
    except Exception:
        logger.exception("Failed to load render setting %s; using %s", key, fallback)
        return fallback
    finally:
        await conn.close()

    if raw is None:
        return fallback
    try:
        value = float(raw)
    except (TypeError, ValueError):
        logger.warning("Invalid render setting %s=%r; using %s", key, raw, fallback)
        return fallback
    if not minimum <= value <= maximum:
        logger.warning("Out-of-range render setting %s=%r; using %s", key, raw, fallback)
        return fallback
    return value


def _fmt_mmss(seconds: float) -> str:
    minutes, secs = divmod(int(seconds), 60)
    return f"{minutes:02d}:{secs:02d}"


async def transcribe(
    audio_path: Path,
    openai_key: str,
) -> tuple[list[dict], list[dict], str]:
    """Return Whisper segments, word timestamps, and an audit transcript."""
    import openai

    client = openai.AsyncOpenAI(api_key=openai_key, timeout=300.0)
    audio_file = io.BytesIO(audio_path.read_bytes())
    audio_file.name = "audio.mp3"
    transcription = await client.audio.transcriptions.create(
        model="whisper-1",
        file=audio_file,  # type: ignore[arg-type]
        language="ja",
        response_format="verbose_json",
        timestamp_granularities=["word", "segment"],
    )
    raw = transcription if isinstance(transcription, dict) else transcription.model_dump()
    segments = [
        {
            "start": float(segment.get("start", 0.0)),
            "end": float(segment.get("end", segment.get("start", 0.0))),
            "text": str(segment.get("text") or "").strip(),
        }
        for segment in raw.get("segments") or []
        if str(segment.get("text") or "").strip()
    ]
    words = [
        {
            "start": float(word.get("start", 0.0)),
            "end": float(word.get("end", word.get("start", 0.0))),
            "word": str(word.get("word") or word.get("text") or ""),
        }
        for word in raw.get("words") or []
        if str(word.get("word") or word.get("text") or "").strip()
    ]
    if not words:
        raise RuntimeError("Whisper returned no word timestamps")
    transcript = "\n".join(
        f"[{_fmt_mmss(segment['start'])}] {segment['text']}"
        for segment in segments
    )
    if not transcript:
        transcript = str(raw.get("text") or "").strip()
    if not transcript:
        raise RuntimeError("Whisper returned an empty transcript")
    return segments, words, transcript


def calculate_source_hash(audio_path: Path, tts_text: str) -> str:
    digest = hashlib.sha256()
    with audio_path.open("rb") as audio_file:
        while chunk := audio_file.read(1024 * 1024):
            digest.update(chunk)
    digest.update(b"\0")
    digest.update(tts_text.encode("utf-8"))
    return digest.hexdigest()


def load_alignment_cache(path: Path, source_hash: str) -> dict | None:
    if not path.exists():
        return None
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if cached.get("source_hash") != source_hash or not cached.get("words"):
        return None
    return cached


def build_chapter_artifacts(
    p4_output: str,
    p_desc_output: str,
    cards: list[subs.Card],
    *,
    source_hash: str | None,
    duration_seconds: float | None = None,
) -> tuple[dict, str | None]:
    specs = chapter_tools.parse_chapter_specs(p4_output)
    resolved = chapter_tools.resolve_chapters(
        specs,
        cards,
        duration_seconds=duration_seconds,
    )
    resolved_duration = (
        duration_seconds
        if duration_seconds is not None and duration_seconds > 0
        else max((card.end for card in cards), default=0.0)
    )
    payload = {
        "source_hash": source_hash,
        "duration_seconds": resolved_duration,
        "chapters": [
            {
                "title": chapter.title,
                "anchor": chapter.anchor,
                "estimated_seconds": chapter.estimated_seconds,
                "estimated_timestamp": chapter_tools.format_chapter_timestamp(
                    chapter.estimated_seconds
                ),
                "resolved_seconds": chapter.seconds,
                "resolved_timestamp": chapter_tools.format_chapter_timestamp(
                    chapter.seconds
                ),
                "method": chapter.method,
                "confidence": chapter.confidence,
            }
            for chapter in resolved
        ],
    }
    updated_description = chapter_tools.replace_description_chapters(
        p_desc_output,
        resolved,
    )
    if specs and not resolved:
        payload["error"] = "Could not resolve at least three valid chapters"
    elif p_desc_output and updated_description is None:
        payload["error"] = "Could not locate the P_desc chapter block"
    return payload, updated_description


async def render_video(
    dsn: str,
    openai_key: str,
    video: dict,
) -> None:
    video_id = int(video["id"])
    token = str(video["render_worker_token"])
    person = str(video.get("featured_person") or "").strip()
    audio_url = str(video.get("audio_url") or "").strip()
    tts_text = str(video.get("tts_text") or "").strip()

    out_dir = OUTPUT_ROOT / str(video_id)
    work_dir = out_dir / ".work" / token
    work_dir.mkdir(parents=True, exist_ok=True)
    stable_audio = out_dir / "audio.mp3"
    stable_ass = out_dir / "sub.ass"
    stable_srt = out_dir / "subtitles.srt"
    stable_alignment = out_dir / "alignment.json"
    stable_chapters = out_dir / "chapters.json"
    stable_video = out_dir / "final_video.mp4"
    work_audio = work_dir / "audio.mp3"
    work_ass = work_dir / "sub.ass"
    work_srt = work_dir / "subtitles.srt"
    work_alignment = work_dir / "alignment.json"
    work_chapters = work_dir / "chapters.json"
    work_video = work_dir / "final_video.mp4"

    async def heartbeat() -> None:
        if STOP_REQUESTED.is_set():
            raise InterruptedError("Render worker stop requested")
        if not await touch_render_heartbeat(dsn, video_id, token):
            raise RuntimeError(f"Lost render lease for video #{video_id}")

    async def heartbeat_loop() -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
            await heartbeat()

    heartbeat_task = asyncio.create_task(heartbeat_loop())
    try:
        if not person:
            raise RuntimeError(f"Video #{video_id} has no featured_person")
        if not audio_url:
            raise RuntimeError(f"Video #{video_id} has no audio_url")
        if not tts_text:
            raise RuntimeError("Missing tts_text; run the render source backfill")

        await heartbeat()
        can_reuse_audio = (
            video.get("rendered_audio_url") == audio_url
            and stable_audio.exists()
            and stable_audio.stat().st_size > 0
        )
        if can_reuse_audio:
            audio_path = stable_audio
            logger.info("Video #%s: reusing cached audio", video_id)
            try:
                await asyncio.to_thread(asm.validate_audio_file, audio_path)
            except Exception:
                logger.warning("Video #%s: cached audio is invalid; downloading again", video_id)
                await asyncio.to_thread(asm.download_audio, audio_url, work_audio)
                audio_path = work_audio
        else:
            logger.info("Video #%s: downloading audio", video_id)
            await asyncio.to_thread(asm.download_audio, audio_url, work_audio)
            audio_path = work_audio
        await asyncio.to_thread(asm.validate_audio_file, audio_path)

        source_hash = await asyncio.to_thread(
            calculate_source_hash,
            audio_path,
            tts_text,
        )
        await heartbeat()

        cache = load_alignment_cache(stable_alignment, source_hash)
        if cache is None:
            logger.info("Video #%s: transcribing with Whisper word timestamps", video_id)
            segments, words, transcript = await wait_for_operation(
                transcribe(audio_path, openai_key)
            )
            cache = {
                "source_hash": source_hash,
                "segments": segments,
                "words": words,
                "transcript": transcript,
            }
            work_alignment.write_text(
                json.dumps(cache, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        else:
            words = list(cache["words"])
            transcript = str(cache.get("transcript") or "")
            logger.info("Video #%s: reusing alignment cache", video_id)

        await save_whisper_transcript(dsn, video_id, token, transcript)
        cards, coverage = subs.write_aligned_subtitles(
            tts_text,
            words,
            work_ass,
            work_srt,
        )
        cache["coverage"] = coverage
        work_alignment.write_text(
            json.dumps(cache, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        logger.info("Video #%s: alignment coverage %.1f%%", video_id, coverage * 100)
        await heartbeat()

        seconds = await get_config_float(
            dsn,
            "render_seconds_per_image",
            asm.SECONDS_PER_IMAGE,
            minimum=5.0,
            maximum=120.0,
        )
        crossfade = await get_config_float(
            dsn,
            "render_crossfade_seconds",
            asm.CROSSFADE_SECONDS,
            minimum=0.0,
            maximum=3.0,
        )
        loop = asyncio.get_running_loop()

        def heartbeat_from_thread() -> None:
            future = asyncio.run_coroutine_threadsafe(heartbeat(), loop)
            future.result(timeout=15)

        logger.info("Video #%s: assembling video", video_id)
        await asyncio.to_thread(
            asm.assemble,
            IMAGE_ROOT / person,
            audio_path,
            work_ass,
            work_video,
            seconds_per_image=seconds,
            crossfade=crossfade,
            seed=video_id,
            heartbeat=heartbeat_from_thread,
        )
        video_duration = await asyncio.to_thread(
            asm.get_media_duration,
            str(work_video),
            asm.resolve_ffprobe(),
        )
        chapter_payload, updated_description = build_chapter_artifacts(
            str(video.get("p4_output") or ""),
            str(video.get("p_desc_output") or ""),
            cards,
            source_hash=source_hash,
            duration_seconds=video_duration,
        )
        work_chapters.write_text(
            json.dumps(chapter_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        if not await owns_render_lease(dsn, video_id, token):
            raise RuntimeError(f"Lost render lease before promoting video #{video_id}")

        out_dir.mkdir(parents=True, exist_ok=True)
        replacements: list[tuple[Path, Path]] = []
        if audio_path == work_audio:
            replacements.append((work_audio, stable_audio))
        replacements.append((work_ass, stable_ass))
        replacements.append((work_srt, stable_srt))
        if work_alignment.exists():
            replacements.append((work_alignment, stable_alignment))
        replacements.append((work_chapters, stable_chapters))
        replacements.append((work_video, stable_video))
        backups, promoted = await asyncio.to_thread(
            promote_files,
            replacements,
            work_dir / "previous",
        )
        try:
            await save_render_done(
                dsn,
                video_id,
                token,
                video_path=str(stable_video),
                audio_url=audio_url,
                source_hash=source_hash,
                description_output=updated_description,
            )
        except Exception:
            await asyncio.to_thread(rollback_promoted_files, backups, promoted)
            raise
        else:
            await asyncio.to_thread(discard_promotion_backups, backups)
    except Exception as exc:
        logger.exception("Video #%s render failed: %s", video_id, exc)
        try:
            await mark_render_failed(dsn, video_id, token, str(exc))
        except Exception:
            logger.exception("Could not mark video #%s render failed", video_id)
        raise
    finally:
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await heartbeat_task
        shutil.rmtree(work_dir, ignore_errors=True)
        work_root = out_dir / ".work"
        try:
            work_root.rmdir()
        except OSError:
            pass


async def backfill_exports(
    dsn: str,
    *,
    video_id: int | None = None,
) -> dict[str, int]:
    rows = await list_rendered_exports(dsn, video_id=video_id)
    summary = {"processed": 0, "skipped": 0, "failed": 0}
    for row in rows:
        current_video_id = int(row["id"])
        out_dir = OUTPUT_ROOT / str(current_video_id)
        stable_ass = out_dir / "sub.ass"
        stable_srt = out_dir / "subtitles.srt"
        stable_chapters = out_dir / "chapters.json"
        stable_video = out_dir / "final_video.mp4"
        if not stable_ass.exists():
            logger.warning("Video #%s: no sub.ass for export backfill", current_video_id)
            summary["skipped"] += 1
            continue

        work_dir = out_dir / ".work" / f"backfill-{uuid4().hex}"
        work_dir.mkdir(parents=True, exist_ok=True)
        work_srt = work_dir / "subtitles.srt"
        work_chapters = work_dir / "chapters.json"
        try:
            _, cards = subs.write_srt_from_ass(stable_ass, work_srt)
            video_duration = await asyncio.to_thread(
                asm.get_media_duration,
                str(stable_video),
                asm.resolve_ffprobe(),
            )
            chapter_payload, updated_description = build_chapter_artifacts(
                str(row.get("p4_output") or ""),
                str(row.get("p_desc_output") or ""),
                cards,
                source_hash=str(row.get("render_source_hash") or "") or None,
                duration_seconds=video_duration,
            )
            work_chapters.write_text(
                json.dumps(chapter_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            backups, promoted = await asyncio.to_thread(
                promote_files,
                [
                    (work_srt, stable_srt),
                    (work_chapters, stable_chapters),
                ],
                work_dir / "previous",
            )
            try:
                if updated_description:
                    await save_resolved_description(
                        dsn,
                        current_video_id,
                        updated_description,
                    )
            except Exception:
                await asyncio.to_thread(
                    rollback_promoted_files,
                    backups,
                    promoted,
                )
                raise
            else:
                await asyncio.to_thread(discard_promotion_backups, backups)
            summary["processed"] += 1
            logger.info("Video #%s: SRT and chapters backfilled", current_video_id)
        except Exception:
            summary["failed"] += 1
            logger.exception("Video #%s export backfill failed", current_video_id)
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
            work_root = out_dir / ".work"
            with contextlib.suppress(OSError):
                work_root.rmdir()
    return summary


async def run(*, once: bool = False) -> None:
    dsn = load_database_url()
    openai_key = load_openai_key()
    logger.info("Render worker started; polling every %ss", POLL_INTERVAL_SECONDS)
    while not STOP_REQUESTED.is_set():
        video = await claim_render_video(dsn)
        if video is None:
            if once:
                return
            for _ in range(POLL_INTERVAL_SECONDS):
                if STOP_REQUESTED.is_set():
                    return
                await asyncio.sleep(1)
            continue
        try:
            await render_video(dsn, openai_key, video)
        except Exception:
            if once:
                raise
        if once:
            return
    logger.info("Render worker stopped")


async def render_specific(video_id: int) -> None:
    dsn = load_database_url()
    openai_key = load_openai_key()
    video = await claim_specific_render(dsn, video_id)
    if video is None:
        raise RuntimeError(
            f"Video #{video_id} is missing audio or is owned by an active render worker"
        )
    await render_video(dsn, openai_key, video)


def main() -> None:
    parser = argparse.ArgumentParser(description="Local render worker for web")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--video-id", type=int)
    parser.add_argument("--backfill-exports", action="store_true")
    args = parser.parse_args()

    STOP_REQUESTED.clear()
    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, request_stop)

    try:
        if args.backfill_exports:
            summary = asyncio.run(
                backfill_exports(
                    load_database_url(),
                    video_id=args.video_id,
                )
            )
            logger.info("Export backfill summary: %s", summary)
        elif args.video_id is not None:
            asyncio.run(render_specific(args.video_id))
        else:
            asyncio.run(run(once=args.once))
    except KeyboardInterrupt:
        request_stop()


if __name__ == "__main__":
    main()
