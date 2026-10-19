# -*- coding: utf-8 -*-
"""
Unit tests for Japanese Audio Drama Video Renderer (video_renderer.py).
"""

import os
import tempfile
from pathlib import Path
import pytest

from video_renderer import (
    build_clip_sequence,
    write_concat_file,
    find_video_assets,
    get_ffmpeg_bin,
    is_nvenc_available,
    DEFAULT_BG_DIR,
)


def test_build_clip_sequence_duration_and_no_adjacent_duplicates():
    # Mock pool of 5 clips with durations
    clips = [
        (Path("/tmp/clip1.mp4"), 10.0),
        (Path("/tmp/clip2.mp4"), 15.0),
        (Path("/tmp/clip3.mp4"), 20.0),
        (Path("/tmp/clip4.mp4"), 12.0),
        (Path("/tmp/clip5.mp4"), 8.0),
    ]

    target_dur = 100.0
    seq = build_clip_sequence(clips, target_duration=target_dur, seed=42, buffer_seconds=5.0)

    # 1. Total duration must be >= target_dur + buffer
    dur_map = dict(clips)
    total_dur = sum(dur_map[p] for p in seq)
    assert total_dur >= target_dur + 5.0

    # 2. No adjacent duplicates
    for i in range(len(seq) - 1):
        assert seq[i] != seq[i + 1], f"Adjacent duplicate found at index {i}: {seq[i]}"


def test_build_clip_sequence_empty_raises():
    with pytest.raises(ValueError):
        build_clip_sequence([], target_duration=50.0)


def test_build_clip_sequence_reproducibility():
    clips = [
        (Path("/tmp/a.mp4"), 10.0),
        (Path("/tmp/b.mp4"), 15.0),
        (Path("/tmp/c.mp4"), 20.0),
    ]
    seq1 = build_clip_sequence(clips, target_duration=50.0, seed=123)
    seq2 = build_clip_sequence(clips, target_duration=50.0, seed=123)
    assert seq1 == seq2


def test_write_concat_file():
    with tempfile.TemporaryDirectory() as tmpdir:
        concat_file = Path(tmpdir) / "concat.txt"
        seq = [Path(tmpdir) / "clip1.mp4", Path(tmpdir) / "clip2.mp4"]
        write_concat_file(seq, concat_file)

        assert concat_file.exists()
        content = concat_file.read_text(encoding="utf-8")
        lines = [line.strip() for line in content.splitlines() if line.strip()]
        assert len(lines) == 2
        assert lines[0].startswith("file '")
        assert lines[0].endswith("clip1.mp4'")
        assert lines[1].endswith("clip2.mp4'")


def test_ffmpeg_environment():
    ffmpeg_bin = get_ffmpeg_bin()
    assert ffmpeg_bin is not None
    assert len(ffmpeg_bin) > 0
    # Check NVENC on local RTX 3060
    nvenc = is_nvenc_available(ffmpeg_bin)
    assert isinstance(nvenc, bool)


def test_find_video_assets_v8():
    # Video 8 folder exists in repository
    assets = find_video_assets(video_id=8)
    assert assets["folder"].exists()
    assert assets["audio_path"].exists()
    assert assets["audio_path"].name.startswith("drama_v8_")
    assert assets["srt_path"] is not None
    assert assets["srt_path"].exists()
    assert assets["output_mp4"].name == "final_v8.mp4"
