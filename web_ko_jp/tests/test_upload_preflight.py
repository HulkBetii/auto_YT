"""
test_upload_preflight.py
========================
Comprehensive unit tests for the pure upload preflight engine.
Tests gate checks, media probing, resolution/aspect ratio validation, and config loading.
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import pytest
import imageio_ffmpeg

from channel_profile import RENDER_SUBDIR
from upload_preflight import (
    MAX_THUMBNAIL_BYTES,
    load_upload_config,
    probe_media,
    run_preflight,
)


@pytest.fixture
def ffmpeg_exe():
    return imageio_ffmpeg.get_ffmpeg_exe()


@pytest.fixture
def mock_upload_env(tmp_path, ffmpeg_exe):
    """Sets up a complete mock environment with valid config, output folder, and valid media files."""
    # 1. Config file
    config_file = tmp_path / "upload_config.json"
    config_data = {
        "gpm_profile_id": "test-gpm-profile-123",
        "nexus_root": str(tmp_path / "Nexus"),
        "nexus_python": str(tmp_path / "nexus_python.exe"),
    }
    # Create fake nexus directories
    (tmp_path / "Nexus" / "src").mkdir(parents=True, exist_ok=True)
    (tmp_path / "nexus_python.exe").write_text("#!fake python", encoding="utf-8")
    config_file.write_text(json.dumps(config_data), encoding="utf-8")

    # 2. Output folder for video 999
    output_base = tmp_path / "output"
    folder = output_base / "v999_test_topic"
    render_dir = folder / RENDER_SUBDIR
    render_dir.mkdir(parents=True, exist_ok=True)

    # 3. Valid MP4 (1280x720, 60 seconds, low framerate for fast encoding)
    mp4_file = render_dir / "final_v999.mp4"
    cmd_mp4 = [
        ffmpeg_exe, "-y", "-f", "lavfi",
        "-i", "color=c=blue:s=1280x720:d=60:r=10",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(mp4_file),
    ]
    subprocess.run(cmd_mp4, capture_output=True, check=True)

    # 4. Valid Thumbnail (1280x720, 1 frame, < 2MB)
    thumb_file = folder / "thumb_v999.png"
    cmd_thumb = [
        ffmpeg_exe, "-y", "-f", "lavfi",
        "-i", "color=c=red:s=1280x720:d=1",
        "-frames:v", "1",
        str(thumb_file),
    ]
    subprocess.run(cmd_thumb, capture_output=True, check=True)

    # 5. Valid Subtitles SRT
    srt_file = folder / "sub_v999.srt"
    srt_content = (
        "1\n00:00:00,000 --> 00:00:10,000\nテスト字幕です。\n\n"
        "2\n00:00:10,000 --> 00:00:45,000\n二行目の字幕です。\n"
    )
    srt_file.write_text(srt_content, encoding="utf-8")

    # 6. Valid data.json matching channel rules
    data_file = folder / "data_v999.json"
    data_content = {
        "title_a_jp": "【関わってはいけない人】先人の知恵が教える付き合うと破滅する人の特徴",
        "title_b_jp": "【先人の知恵】縁を切るべき人の特徴",
        "title_c_jp": "【処世術】60代で気づくべき人間の本性",
        "description_jp": (
            "先人の知恵に学ぶ処世術。\n\n"
            "▼目次\n"
            "00:00 はじめに\n"
            "00:15 関わってはいけない人の特徴\n"
            "00:30 まとめ\n\n"
            "#人間関係 #人生哲学 #先人の知恵\n合成音声による朗読です。"
        ),
        "youtube_tags": "先人の知恵, 処世術, 人間関係, 人生哲学",
        "pinned_comment": "ご覧いただきありがとうございます。",
        "thumbnail_text": "善人の仮面\n本性が出る\n縁を切れ",
        "final_script_jp": "関わってはいけない人について先人の知恵を語ります。",
        "audio_duration_seconds": 60.0,
    }
    data_file.write_text(json.dumps(data_content, ensure_ascii=False), encoding="utf-8")

    return {
        "tmp_path": tmp_path,
        "config_file": config_file,
        "output_base": output_base,
        "folder": folder,
        "mp4_file": mp4_file,
        "thumb_file": thumb_file,
        "srt_file": srt_file,
        "data_file": data_file,
    }


def test_probe_media_dimensions_and_duration(mock_upload_env):
    mp4_path = mock_upload_env["mp4_file"]
    probe = probe_media(mp4_path)
    assert probe["width"] == 1280
    assert probe["height"] == 720
    assert probe["duration"] is not None
    assert abs(probe["duration"] - 60.0) < 1.5


def test_load_upload_config_validation(tmp_path):
    # Non-existent config
    cfg, errs = load_upload_config(tmp_path / "nonexistent.json")
    assert cfg is None
    assert any("not found" in e for e in errs)

    # Config with placeholder gpm_profile_id
    cfg_file = tmp_path / "cfg.json"
    cfg_file.write_text(json.dumps({"gpm_profile_id": "REPLACE_WITH_YOUR_GPM_PROFILE_ID"}), encoding="utf-8")
    cfg, errs = load_upload_config(cfg_file)
    assert any("gpm_profile_id is missing" in e for e in errs)


def test_preflight_blocks_when_mp4_missing(mock_upload_env, monkeypatch):
    env = mock_upload_env
    # Delete mp4 file
    env["mp4_file"].unlink()

    monkeypatch.setattr(
        "upload_preflight.fetch_video_record",
        lambda vid: {"id": vid, "title_jp": "テストタイトル", "transcript_text": "text"},
    )

    result = run_preflight(
        video_id=999,
        ack_warn=True,
        config_path=env["config_file"],
        skip_gpm_check=True,
        output_base=env["output_base"],
    )
    assert result.ok is False
    assert any("Missing final rendered MP4" in e for e in result.errors)


def test_preflight_blocks_when_duration_diff_exceeds_2s(mock_upload_env, monkeypatch):
    env = mock_upload_env
    # Modify data.json audio duration to 15.0s (MP4 is 5.0s -> diff is 10s > 2s limit)
    data = json.loads(env["data_file"].read_text(encoding="utf-8"))
    data["audio_duration_seconds"] = 15.0
    env["data_file"].write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr(
        "upload_preflight.fetch_video_record",
        lambda vid: {"id": vid, "title_jp": "テストタイトル", "audio_duration": 15, "transcript_text": "text"},
    )

    result = run_preflight(
        video_id=999,
        ack_warn=True,
        config_path=env["config_file"],
        skip_gpm_check=True,
        output_base=env["output_base"],
    )
    assert result.ok is False
    assert any("differs from audio duration" in e for e in result.errors)


def test_preflight_blocks_when_thumbnail_exceeds_2mb(mock_upload_env, monkeypatch):
    env = mock_upload_env
    # Inflate thumbnail to 2.5MB
    large_bytes = b"0" * (MAX_THUMBNAIL_BYTES + 500_000)
    env["thumb_file"].write_bytes(large_bytes)

    monkeypatch.setattr(
        "upload_preflight.fetch_video_record",
        lambda vid: {"id": vid, "title_jp": "テストタイトル", "transcript_text": "text"},
    )

    result = run_preflight(
        video_id=999,
        ack_warn=True,
        config_path=env["config_file"],
        skip_gpm_check=True,
        output_base=env["output_base"],
    )
    assert result.ok is False
    assert any("exceeds YouTube's 2MB limit" in e for e in result.errors)


def test_preflight_blocks_when_srt_missing(mock_upload_env, monkeypatch):
    env = mock_upload_env
    # Remove SRT file
    env["srt_file"].unlink()

    monkeypatch.setattr(
        "upload_preflight.fetch_video_record",
        lambda vid: {"id": vid, "title_jp": "テストタイトル", "transcript_text": "text"},
    )

    result = run_preflight(
        video_id=999,
        ack_warn=True,
        config_path=env["config_file"],
        skip_gpm_check=True,
        output_base=env["output_base"],
    )
    assert result.ok is False
    assert any("Japanese subtitles (.srt) file missing" in e for e in result.errors)


def test_preflight_blocks_warn_without_ack(mock_upload_env, monkeypatch):
    env = mock_upload_env
    # Set data.json with a thumbnail repeating title (triggers WARN thumbnail_repeats_title)
    data = json.loads(env["data_file"].read_text(encoding="utf-8"))
    data["thumbnail_text"] = "先人の知恵\n本性が出る\n縁を切れ"  # "先人の知恵" repeated
    env["data_file"].write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr(
        "upload_preflight.fetch_video_record",
        lambda vid: {"id": vid, "title_jp": data["title_a_jp"], "transcript_text": "text"},
    )

    # Without ack_warn: must fail
    res_no_ack = run_preflight(
        video_id=999,
        ack_warn=False,
        config_path=env["config_file"],
        skip_gpm_check=True,
        output_base=env["output_base"],
    )
    assert res_no_ack.ok is False
    assert res_no_ack.status in ("WARN_ACK_REQUIRED", "FAIL")

    # With ack_warn: passes
    res_ack = run_preflight(
        video_id=999,
        ack_warn=True,
        config_path=env["config_file"],
        skip_gpm_check=True,
        output_base=env["output_base"],
    )
    # The gate check should now pass
    gate_check = next(c for c in res_ack.checks if c.id == "metadata_gate")
    assert gate_check.passed is True
