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
