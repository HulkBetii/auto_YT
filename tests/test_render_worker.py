import asyncio
import json
from pathlib import Path

import pytest

from auto_yt import render_worker
from auto_yt.render import assemble


def test_promotion_rollback_preserves_previous_video(tmp_path: Path) -> None:
    work = tmp_path / "work"
    stable = tmp_path / "stable"
    work.mkdir()
    stable.mkdir()
    new_video = work / "final_video.mp4"
    old_video = stable / "final_video.mp4"
    new_video.write_bytes(b"new")
    old_video.write_bytes(b"old")

    backups, promoted = render_worker.promote_files(
        [(new_video, old_video)],
        work / "previous",
    )
    assert old_video.read_bytes() == b"new"

    render_worker.rollback_promoted_files(backups, promoted)

    assert old_video.read_bytes() == b"old"


def test_promotion_commit_keeps_new_video(tmp_path: Path) -> None:
    work = tmp_path / "work"
    stable = tmp_path / "stable"
    work.mkdir()
    stable.mkdir()
    new_video = work / "final_video.mp4"
    old_video = stable / "final_video.mp4"
    new_video.write_bytes(b"new")
    old_video.write_bytes(b"old")

    backups, _ = render_worker.promote_files(
        [(new_video, old_video)],
        work / "previous",
    )
    render_worker.discard_promotion_backups(backups)

    assert old_video.read_bytes() == b"new"
    assert not backups[0][1].exists()

def test_promotion_rollback_preserves_previous_video_srt_and_chapters(
    tmp_path: Path,
) -> None:
    work = tmp_path / "work"
    stable = tmp_path / "stable"
    work.mkdir()
    stable.mkdir()
    replacements = []
    for filename in ("final_video.mp4", "subtitles.srt", "chapters.json"):
        new_file = work / filename
        stable_file = stable / filename
        new_file.write_bytes(f"new-{filename}".encode())
        stable_file.write_bytes(f"old-{filename}".encode())
        replacements.append((new_file, stable_file))

    backups, promoted = render_worker.promote_files(
        replacements,
        work / "previous",
    )
    render_worker.rollback_promoted_files(backups, promoted)

    for filename in ("final_video.mp4", "subtitles.srt", "chapters.json"):
        assert (stable / filename).read_bytes() == f"old-{filename}".encode()

def test_build_chapter_artifacts_records_estimated_and_resolved_timestamps() -> None:
    p4_output = """■ チャプター設計
00:00 導入 | ANCHOR: 導入を始めます
01:00 本編 | ANCHOR: 本編を始めます
02:00 結び | ANCHOR: 結びを始めます
"""
    description = """⏱ チャプター
━━━━━━━━━━━━━━━━━━━━━━━━
00:00 古い導入
01:00 古い本編
02:00 古い結び

━━━━━━━━━━━━━━━━━━━━━━━━
🎬 おすすめの動画
"""
    cards = [
        render_worker.subs.Card(0.0, 12.0, ["導入を始めます。"]),
        render_worker.subs.Card(30.0, 42.0, ["本編を始めます。"]),
        render_worker.subs.Card(60.0, 72.0, ["結びを始めます。"]),
        render_worker.subs.Card(80.0, 90.0, ["終わりです。"]),
    ]

    payload, updated = render_worker.build_chapter_artifacts(
        p4_output,
        description,
        cards,
        source_hash="source-hash",
        duration_seconds=89.5,
    )

    assert payload["source_hash"] == "source-hash"
    assert payload["duration_seconds"] == 89.5
    assert payload["chapters"][1]["estimated_timestamp"] == "01:00"
    assert payload["chapters"][1]["resolved_timestamp"] == "00:30"
    assert payload["chapters"][1]["method"] == "anchor"
    assert "00:30 本編" in (updated or "")

def test_backfill_exports_uses_existing_ass_without_whisper(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output_root = tmp_path / "renders"
    render_dir = output_root / "2"
    render_dir.mkdir(parents=True)
    (render_dir / "sub.ass").write_text(
        "\n".join(
            [
                "[Events]",
                r"Dialogue: 0,0:00:00.00,0:00:12.00,Quote,,0,0,0,,{\an4}導入を始めます。",
                r"Dialogue: 0,0:00:30.00,0:00:42.00,Quote,,0,0,0,,{\an4}本編を始めます。",
                r"Dialogue: 0,0:01:00.00,0:01:12.00,Quote,,0,0,0,,{\an4}結びを始めます。",
                r"Dialogue: 0,0:01:20.00,0:01:30.00,Quote,,0,0,0,,{\an4}終わりです。",
            ]
        ),
        encoding="utf-8",
    )
    p4_output = """■ チャプター設計
00:00 導入 | ANCHOR: 導入を始めます
01:00 本編 | ANCHOR: 本編を始めます
02:00 結び | ANCHOR: 結びを始めます
"""
    description = """⏱ チャプター
━━━━━━━━━━━━━━━━━━━━━━━━
00:00 古い導入
01:00 古い本編
02:00 古い結び

━━━━━━━━━━━━━━━━━━━━━━━━
🎬 おすすめの動画
"""
    saved_descriptions: list[str] = []

    async def fake_list_rendered_exports(
        _dsn: str,
        *,
        video_id: int | None = None,
    ) -> list[dict]:
        assert video_id is None
        return [
            {
                "id": 2,
                "render_source_hash": "source-hash",
                "p4_output": p4_output,
                "p_desc_output": description,
            }
        ]

    async def fake_save_resolved_description(
        _dsn: str,
        video_id: int,
        output: str,
    ) -> None:
        assert video_id == 2
        saved_descriptions.append(output)

    monkeypatch.setattr(render_worker, "OUTPUT_ROOT", output_root)
    monkeypatch.setattr(
        render_worker,
        "list_rendered_exports",
        fake_list_rendered_exports,
    )
    monkeypatch.setattr(
        render_worker,
        "save_resolved_description",
        fake_save_resolved_description,
    )
    monkeypatch.setattr(
        render_worker,
        "transcribe",
        lambda *_args, **_kwargs: pytest.fail("Whisper must not run during export backfill"),
    )
    monkeypatch.setattr(render_worker.asm, "resolve_ffprobe", lambda: "ffprobe")
    monkeypatch.setattr(
        render_worker.asm,
        "get_media_duration",
        lambda *_args: 90.0,
    )

    summary = asyncio.run(render_worker.backfill_exports("unused"))

    assert summary == {"processed": 1, "skipped": 0, "failed": 0}
    assert (render_dir / "subtitles.srt").exists()
    payload = json.loads((render_dir / "chapters.json").read_text(encoding="utf-8"))
    assert payload["chapters"][1]["resolved_timestamp"] == "00:30"
    assert saved_descriptions and "00:30 本編" in saved_descriptions[0]
    assert not (render_dir / "alignment.json").exists()


def test_image_selection_is_deterministic_for_video_seed(tmp_path: Path) -> None:
    pool = []
    for index in range(5):
        image = tmp_path / f"{index}.png"
        image.write_bytes(b"image")
        pool.append(image)

    first = assemble.select_images(pool, 12, seed=42)
    second = assemble.select_images(pool, 12, seed=42)

    assert first == second
    assert len(set(first[:5])) == 5


def test_crossfade_zero_uses_concat_filter(tmp_path: Path) -> None:
    filtergraph = assemble._build_filter(
        3,
        30.0,
        0.0,
        tmp_path / "sub.ass",
        tmp_path / "fonts",
    )

    assert "concat=n=3:v=1:a=0" in filtergraph
    assert "xfade=" not in filtergraph


def test_empty_audio_is_rejected_before_ffprobe(tmp_path: Path) -> None:
    audio = tmp_path / "audio.mp3"
    audio.touch()

    with pytest.raises(RuntimeError, match="missing or empty"):
        assemble.validate_audio_file(audio)


def test_nvenc_failure_retries_with_libx264(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    image_dir = tmp_path / "images"
    image_dir.mkdir()
    (image_dir / "one.png").write_bytes(b"image")
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"audio")
    subtitles = tmp_path / "sub.ass"
    subtitles.write_text("[Events]\n", encoding="utf-8")
    output = tmp_path / "final_video.mp4"
    commands: list[list[str]] = []

    monkeypatch.setattr(assemble, "resolve_ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr(assemble, "resolve_ffprobe", lambda: "ffprobe")
    monkeypatch.setattr(assemble, "validate_audio_file", lambda *_args: 1.0)
    monkeypatch.setattr(
        assemble,
        "_video_encoder_args",
        lambda _ffmpeg: ["-c:v", "h264_nvenc", "-preset", "p5"],
    )
    monkeypatch.setattr(
        assemble,
        "get_media_stream_types",
        lambda *_args: {"audio", "video"},
    )
    monkeypatch.setattr(assemble, "get_media_duration", lambda *_args: 1.0)

    def fake_run(
        command: list[str],
        *,
        heartbeat,
    ) -> tuple[int, str]:
        commands.append(command)
        if len(commands) == 1:
            return 1, "NVENC unavailable"
        output.write_bytes(b"video")
        return 0, ""

    monkeypatch.setattr(assemble, "_run_ffmpeg", fake_run)

    assemble.assemble(image_dir, audio, subtitles, output)

    assert len(commands) == 2
    assert "h264_nvenc" in commands[0]
    assert "libx264" in commands[1]


def test_cli_failure_is_not_swallowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_run(operation) -> None:
        operation.close()
        raise RuntimeError("boom")

    monkeypatch.setattr(render_worker.signal, "signal", lambda *_args: None)
    monkeypatch.setattr(render_worker.sys, "argv", ["render_worker", "--once"])
    monkeypatch.setattr(render_worker.asyncio, "run", fail_run)

    with pytest.raises(RuntimeError, match="boom"):
        render_worker.main()
