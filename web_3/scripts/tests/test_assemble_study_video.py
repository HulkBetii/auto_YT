from __future__ import annotations

import os
import math
import shutil
import subprocess
import sys
import tempfile
import unittest
from array import array
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from assemble_study_video import (  # noqa: E402
    AssemblyError,
    AudioTrackInfo,
    DEFAULT_STUDY_OVERLAY_FONT,
    FootageInfo,
    LoudnessMeasurement,
    OutputInfo,
    SilentMasterInfo,
    _audio_filter,
    _loudnorm_filter,
    _measure_loudness,
    _normalize_sequence,
    _parse_loudnorm_measurement,
    _normalized_video_filter,
    _pomodoro_video_filter,
    _resolve_timer_font,
    _validate_silent_master,
    _validate_final_loudness,
    _video_filter,
    build_audio_sequence,
    build_pomodoro_cue_schedule,
    build_pomodoro_duck_windows,
    compute_input_signature,
    compute_master_signature,
    encoder_args,
    is_supported_aspect_ratio,
    natural_sort_key,
    pomodoro_state_at,
    probe_output,
    rotate_tracks,
    scan_audio_tracks,
    scan_footage,
    assemble_media,
    week_number_for_day,
    _ensure_silent_master,
    _find_valid_cached_master,
    clamp_preview_window,
    select_preview_footage_slices,
    render_preview_media,
)


def make_track(index: int, duration_sec: float = 10.0) -> AudioTrackInfo:
    return AudioTrackInfo(
        path=Path(f"{index:02d}.mp3"),
        relative_path=f"audio/week-001/{index:02d}.mp3",
        sha256=f"sha-{index}",
        size_bytes=100,
        duration_sec=duration_sec,
        codec_name="mp3",
        sample_rate=44100,
        channels=2,
    )


def make_footage(index: int = 1, duration_sec: float = 120.0) -> FootageInfo:
    return FootageInfo(
        path=Path(f"clip{index}.mp4"),
        relative_path=f"daily/day-001/source/clip{index}.mp4",
        sha256=f"footage-{index}",
        size_bytes=1000,
        duration_sec=duration_sec,
        width=1920,
        height=1080,
        frame_rate=30.0,
        codec_name="h264",
        has_audio=False,
    )


class HelperTests(unittest.TestCase):
    def test_timer_font_uses_pinned_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(_resolve_timer_font(), DEFAULT_STUDY_OVERLAY_FONT.resolve())

    def test_timer_font_accepts_custom_absolute_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            font_path = Path(temp) / "custom.ttf"
            font_path.write_bytes(b"test font")
            with patch.dict(os.environ, {"STUDY_OVERLAY_FONT": str(font_path)}, clear=True):
                self.assertEqual(_resolve_timer_font(), font_path.resolve())

    def test_timer_font_rejects_relative_missing_and_directory_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            invalid_paths = [Path("fonts/consolab.ttf"), Path(temp) / "missing.ttf", Path(temp)]
            for font_path in invalid_paths:
                with self.subTest(font_path=font_path):
                    with patch.dict(
                        os.environ,
                        {"STUDY_OVERLAY_FONT": str(font_path)},
                        clear=True,
                    ):
                        with self.assertRaisesRegex(
                            AssemblyError,
                            "STUDY_OVERLAY_FONT.*existing font file",
                        ):
                            _resolve_timer_font()

    def test_preview_window_clamps_to_source(self) -> None:
        self.assertEqual(clamp_preview_window(0, 60), (0, 60))
        self.assertEqual(clamp_preview_window(999, 120), (30, 90))

    def test_preview_slices_only_include_intersecting_footage(self) -> None:
        footage = [make_footage(1, 100), make_footage(2, 100), make_footage(3, 100)]
        slices = select_preview_footage_slices(footage, 50, 90)
        self.assertEqual(
            [(item.footage.path.name, item.source_offset_sec, item.duration_sec) for item in slices],
            [("clip1.mp4", 50, 50), ("clip2.mp4", 0, 40)],
        )
        exact = select_preview_footage_slices(footage, 100, 90)
        self.assertEqual([item.footage.path.name for item in exact], ["clip2.mp4"])

    def test_preview_timer_uses_absolute_timeline(self) -> None:
        self.assertEqual(pomodoro_state_at(2970), ("FOCUS", 30))
        timer = _pomodoro_video_filter(
            focus_duration_sec=50,
            break_duration_sec=5,
            font_path=Path("C:/Windows/Fonts/consolab.ttf"),
            timeline_offset_sec=2970,
        )
        self.assertIn("t+2970.000000", timer)
    def test_natural_sort(self) -> None:
        values = ["clip10.mp4", "Clip2.mp4", "clip1.mp4"]
        self.assertEqual(
            sorted(values, key=natural_sort_key),
            ["clip1.mp4", "Clip2.mp4", "clip10.mp4"],
        )
        punctuation_values = [
            "track_2.mp3",
            "track-10.mp3",
            "track 1.mp3",
            "Track.3.mp3",
            "track(4).mp3",
        ]
        self.assertEqual(
            sorted(punctuation_values, key=natural_sort_key),
            [
                "track 1.mp3",
                "track(4).mp3",
                "track-10.mp3",
                "Track.3.mp3",
                "track_2.mp3",
            ],
        )

    def test_week_number_for_day(self) -> None:
        self.assertEqual(week_number_for_day(1), 1)
        self.assertEqual(week_number_for_day(7), 1)
        self.assertEqual(week_number_for_day(8), 2)
        self.assertEqual(week_number_for_day(364), 52)
        self.assertEqual(week_number_for_day(365), 53)
        with self.assertRaises(AssemblyError):
            week_number_for_day(366)

    def test_aspect_ratio_tolerance(self) -> None:
        self.assertTrue(is_supported_aspect_ratio(1920, 1080))
        self.assertTrue(is_supported_aspect_ratio(1900, 1080))
        self.assertFalse(is_supported_aspect_ratio(1600, 1080))
        self.assertFalse(is_supported_aspect_ratio(1080, 1920))

    def test_track_rotation(self) -> None:
        tracks = [make_track(index) for index in range(20)]
        rotated = rotate_tracks(tracks, day_number=3)
        self.assertEqual(rotated[0].path.name, "02.mp3")
        self.assertEqual(rotated[-1].path.name, "01.mp3")

    def test_audio_sequence_accounts_for_crossfade(self) -> None:
        tracks = [make_track(index) for index in range(20)]
        sequence = build_audio_sequence(tracks, day_number=1, target_duration_sec=30, crossfade_sec=3)
        self.assertEqual(len(sequence), 5)
        effective_duration = sum(item.duration_sec for item in sequence) - 3 * len(sequence)
        self.assertGreaterEqual(effective_duration, 30)

    def test_audio_sequence_loops_after_all_twenty_tracks(self) -> None:
        tracks = [make_track(index) for index in range(20)]
        sequence = build_audio_sequence(
            tracks,
            day_number=3,
            target_duration_sec=150,
            crossfade_sec=3,
        )
        self.assertGreater(len(sequence), 20)
        self.assertEqual(sequence[0].path.name, "02.mp3")
        self.assertEqual(sequence[20].path.name, "02.mp3")
        effective_duration = sum(item.duration_sec for item in sequence) - 3 * len(sequence)
        self.assertGreaterEqual(effective_duration, 150)

    def test_track_must_be_longer_than_crossfade(self) -> None:
        tracks = [replace(make_track(index), duration_sec=3.0) for index in range(20)]
        with self.assertRaises(AssemblyError):
            build_audio_sequence(tracks, day_number=1, target_duration_sec=30, crossfade_sec=3)

    def test_signature_is_stable_and_order_sensitive(self) -> None:
        first = compute_input_signature(1, 1, ["a", "b"], ["c", "d"])
        second = compute_input_signature(1, 1, ["a", "b"], ["c", "d"])
        reordered = compute_input_signature(1, 1, ["b", "a"], ["c", "d"])
        self.assertEqual(first, second)
        self.assertNotEqual(first, reordered)
        self.assertEqual(
            first,
            "f0b66dbc55c264c538d0e41f22487920ff510c700a8964bc6a1fa2b1202e052d",
        )
        self.assertNotEqual(
            first,
            compute_input_signature(
                1,
                1,
                ["a", "b"],
                ["c", "d"],
                assembly_profile="study-pomodoro-v1",
            ),
        )

    def test_master_signature_is_footage_only_and_order_sensitive(self) -> None:
        self.assertEqual(
            compute_master_signature(["a", "b"]),
            "140dc15e96f1ec21d05deee5a876e7118ef1b3fa498bb45a6d52daaedcf78dc3",
        )
        self.assertNotEqual(
            compute_master_signature(["a", "b"]),
            compute_master_signature(["b", "a"]),
        )

    def test_pomodoro_phase_boundaries(self) -> None:
        cases = [
            (0, ("FOCUS", 3000)),
            (2999, ("FOCUS", 1)),
            (3000, ("BREAK", 300)),
            (3299, ("BREAK", 1)),
            (3300, ("FOCUS", 3000)),
            (6300, ("BREAK", 300)),
        ]
        for elapsed_sec, expected in cases:
            with self.subTest(elapsed_sec=elapsed_sec):
                self.assertEqual(pomodoro_state_at(elapsed_sec), expected)

    def test_pomodoro_cues_and_duck_windows(self) -> None:
        duration_sec = 3301
        cues = build_pomodoro_cue_schedule(duration_sec)
        self.assertEqual(
            [(cue.phase, cue.start_sec) for cue in cues],
            [
                ("FOCUS", 0.0),
                ("BREAK", 3000.0),
                ("BREAK", 3000.4),
                ("FOCUS", 3300.0),
            ],
        )
        self.assertTrue(all(cue.start_sec < duration_sec for cue in cues))
        self.assertEqual(
            build_pomodoro_duck_windows(duration_sec),
            [(0.0, 2.0), (2999.0, 3001.0), (3299.0, 3301)],
        )

    def test_pomodoro_filter_graph_contains_locked_style_and_cues(self) -> None:
        normalized_filter = _normalized_video_filter(1)
        self.assertIn("scale=1920:1080", normalized_filter)
        self.assertNotIn("drawtext", normalized_filter)

        timer_filter = _pomodoro_video_filter(
            focus_duration_sec=4,
            break_duration_sec=2,
            font_path=Path("C:/Windows/Fonts/consolab.ttf"),
        )
        self.assertNotIn("scale=1920:1080", timer_filter)
        self.assertIn("drawtext", timer_filter)

        video_filter = _video_filter(1, 4, 2, Path("C:/Windows/Fonts/consolab.ttf"))
        self.assertIn("fontcolor=0x67E8F9", video_filter)
        self.assertIn("fontcolor=0xF59E0B", video_filter)
        self.assertIn("boxcolor=black@0.65", video_filter)
        self.assertIn("x=w-tw-48-18:y=h-th-48-18", video_filter)
        self.assertIn("FOCUS", video_filter)
        self.assertIn("BREAK", video_filter)

        audio_filter = _audio_filter(2, 7, 0.05, 4, 2)
        self.assertIn("sin(2*PI*880*t)", audio_filter)
        self.assertIn("sin(2*PI*660*t)", audio_filter)
        self.assertIn("adelay=4000|4000", audio_filter)
        self.assertIn("adelay=4400|4400", audio_filter)
        self.assertIn("volume=volume=0.630957", audio_filter)
        self.assertIn("alimiter=limit=0.794328", audio_filter)
        self.assertNotIn("loudnorm", audio_filter)
        self.assertLess(audio_filter.index("acrossfade"), audio_filter.index("afade"))
        self.assertLess(audio_filter.index("afade"), audio_filter.index("volume="))
        self.assertLess(audio_filter.index("volume="), audio_filter.index("amix=inputs=2"))
        self.assertLess(audio_filter.index("amix=inputs=2"), audio_filter.index("alimiter"))
        self.assertLess(audio_filter.index("alimiter"), audio_filter.rindex("atrim="))

    def test_preview_audio_filter_keeps_absolute_timeline(self) -> None:
        audio_filter = _audio_filter(
            1,
            3060,
            0.05,
            3000,
            300,
            timeline_start_sec=2970,
            output_duration_sec=90,
            full_duration_sec=6000,
        )
        self.assertIn("adelay=3000000|3000000", audio_filter)
        self.assertIn("atrim=start=2970.000000:end=3060.000000", audio_filter)

    def test_loudnorm_measurement_and_apply_filter(self) -> None:
        output = """
        [Parsed_loudnorm_0] {
            "input_i" : "-22.10",
            "input_tp" : "-4.20",
            "input_lra" : "3.10",
            "input_thresh" : "-32.20",
            "target_offset" : "0.30"
        }
        """
        measured = _parse_loudnorm_measurement(output)
        self.assertEqual(measured.integrated_lufs, -22.1)
        apply_filter = _loudnorm_filter(measured=measured, print_format="summary")
        self.assertIn("measured_I=-22.100000", apply_filter)
        self.assertIn("measured_TP=-4.200000", apply_filter)
        self.assertIn("linear=true", apply_filter)

    def test_normalized_tracks_are_reused_when_playlist_loops(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            first = make_track(1)
            second = make_track(2)

            def normalize(source, destination):
                return replace(source, path=destination, codec_name="flac")

            with patch("assemble_study_video._normalize_track", side_effect=normalize) as normalize_mock:
                result = _normalize_sequence([first, second, first], Path(temp))
            self.assertEqual(normalize_mock.call_count, 2)
            self.assertEqual(result[0].path, result[2].path)

    def test_final_loudness_acceptance_checks_lufs_and_true_peak(self) -> None:
        accepted = LoudnessMeasurement(-16.2, -1.7, 4.0, -26.0, 0.0)
        with patch("assemble_study_video._measure_loudness", return_value=accepted):
            self.assertEqual(_validate_final_loudness(Path("final.mp4")), accepted)
        with patch(
            "assemble_study_video._measure_loudness",
            return_value=replace(accepted, integrated_lufs=-17.2),
        ):
            with self.assertRaises(AssemblyError):
                _validate_final_loudness(Path("final.mp4"))
        with patch(
            "assemble_study_video._measure_loudness",
            return_value=replace(accepted, true_peak_dbtp=-1.4),
        ):
            with self.assertRaises(AssemblyError):
                _validate_final_loudness(Path("final.mp4"))

    def test_silent_master_validation(self) -> None:
        valid = SilentMasterInfo(
            duration_sec=120.0,
            width=1920,
            height=1080,
            frame_rate=30.0,
            video_codec="h264",
            pixel_format="yuv420p",
        )
        _validate_silent_master(valid, 120.0)
        invalid_cases = [
            replace(valid, width=1280),
            replace(valid, frame_rate=25.0),
            replace(valid, video_codec="hevc"),
            replace(valid, pixel_format="yuv444p"),
            replace(valid, duration_sec=123.0),
        ]
        for invalid in invalid_cases:
            with self.subTest(invalid=invalid):
                with self.assertRaises(AssemblyError):
                    _validate_silent_master(invalid, 120.0)

    def test_encoder_arguments(self) -> None:
        self.assertIn("h264_nvenc", encoder_args(True))
        self.assertIn("libx264", encoder_args(False))


class MasterCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_cache_hit_skips_master_render(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            master = Path(temp) / "master_silent.mp4"
            master.write_bytes(b"cached")
            footage = [make_footage()]
            signature = compute_master_signature([footage[0].sha256])
            context = {"master_signature": signature, "master_path": "daily/day-001/work/master_silent.mp4"}
            valid = SilentMasterInfo(120.0, 1920, 1080, 30.0, "h264", "yuv420p")
            with (
                patch("assemble_study_video.probe_silent_master", return_value=valid),
                patch("assemble_study_video._render_silent_master") as render,
                patch("assemble_study_video._mark_master_ready", new_callable=AsyncMock) as mark,
            ):
                result = await _ensure_silent_master(
                    1,
                    context,
                    footage,
                    master,
                    "daily/day-001/work/master_silent.mp4",
                    120.0,
                    "lease",
                )
            self.assertEqual(result, master)
            render.assert_not_called()
            mark.assert_not_awaited()

    async def test_cache_miss_rebuilds_and_promotes_master(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            master = Path(temp) / "master_silent.mp4"
            master.write_bytes(b"stale")
            footage = [make_footage()]
            valid = SilentMasterInfo(120.0, 1920, 1080, 30.0, "h264", "yuv420p")

            def render(_footage, destination, _use_nvenc):
                destination.write_bytes(b"fresh")

            async def promote(_video_id, _signature, _relative, _created, _lease, candidate, destination):
                os.replace(candidate, destination)

            with (
                patch("assemble_study_video.nvenc_runtime_available", return_value=False),
                patch("assemble_study_video.probe_silent_master", return_value=valid),
                patch("assemble_study_video._render_silent_master", side_effect=render) as render_mock,
                patch("assemble_study_video._mark_master_ready", new_callable=AsyncMock, side_effect=promote) as mark,
            ):
                result = await _ensure_silent_master(
                    1,
                    {"master_signature": "old", "master_path": "old/path"},
                    footage,
                    master,
                    "daily/day-001/work/master_silent.mp4",
                    120.0,
                    "lease",
                )
            self.assertEqual(result, master)
            self.assertEqual(master.read_bytes(), b"fresh")
            render_mock.assert_called_once()
            mark.assert_awaited_once()


class PreviewRenderTests(unittest.TestCase):
    def test_valid_master_is_reused_without_touching_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            master = Path(temp) / "master_silent.mp4"
            master.write_bytes(b"cached")
            footage = [make_footage(1, 120)]
            context = {
                "master_signature": compute_master_signature([footage[0].sha256]),
                "master_path": "daily/day-001/work/master_silent.mp4",
            }
            valid = SilentMasterInfo(120.0, 1920, 1080, 30.0, "h264", "yuv420p")
            with patch("assemble_study_video.probe_silent_master", return_value=valid):
                result = _find_valid_cached_master(
                    context,
                    footage,
                    master,
                    "daily/day-001/work/master_silent.mp4",
                    120,
                )
            self.assertEqual(result, master)
            self.assertTrue(master.exists())

    def test_preview_render_uses_master_or_only_intersecting_slices(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            destination = root / "preview-attempt.mp4"
            master = root / "master_silent.mp4"
            master.write_bytes(b"master")
            footage = [make_footage(1, 100), make_footage(2, 100), make_footage(3, 100)]
            tracks = [make_track(index, 200) for index in range(20)]
            valid_output = OutputInfo(90.0, 1920, 1080, 30.0, "h264", "aac")

            def write_destination(*args, **_kwargs) -> None:
                Path(args[1]).write_bytes(b"stream")

            def mux(_video, _audio, output, _duration) -> None:
                output.write_bytes(b"preview")

            with (
                patch("assemble_study_video.nvenc_runtime_available", return_value=False),
                patch("assemble_study_video._render_preview_video_from_master", side_effect=write_destination) as from_master,
                patch("assemble_study_video._render_preview_video_from_footage", side_effect=write_destination) as from_footage,
                patch("assemble_study_video._render_audio", side_effect=write_destination),
                patch("assemble_study_video._normalize_sequence", side_effect=lambda sequence, _temp: list(sequence)),
                patch("assemble_study_video._mux_preview", side_effect=mux),
                patch("assemble_study_video.probe_output", return_value=valid_output),
                patch("assemble_study_video._validate_output"),
                patch("assemble_study_video._validate_final_loudness"),
            ):
                render_preview_media(
                    footage,
                    tracks,
                    1,
                    destination,
                    300,
                    50,
                    90,
                    master_path=master,
                )
                from_master.assert_called_once()
                from_footage.assert_not_called()

                destination.unlink()
                render_preview_media(
                    footage,
                    tracks,
                    1,
                    destination,
                    300,
                    50,
                    90,
                )
                selected = from_footage.call_args.args[0]
                self.assertEqual(
                    [(item.footage.path.name, item.duration_sec) for item in selected],
                    [("clip1.mp4", 50), ("clip2.mp4", 40)],
                )


@unittest.skipUnless(
    os.getenv("RUN_STUDY_FFMPEG_SMOKE") == "1"
    and shutil.which("ffmpeg")
    and shutil.which("ffprobe"),
    "Set RUN_STUDY_FFMPEG_SMOKE=1 to run the FFmpeg smoke test.",
)
class FfmpegSmokeTests(unittest.TestCase):
    def run_ffmpeg(self, command: list[str]) -> None:
        subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *command],
            check=True,
        )

    def extract_timer_frame(self, video_path: Path, timestamp_sec: float) -> bytes:
        result = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(video_path),
                "-ss",
                f"{timestamp_sec:g}",
                "-vf",
                "crop=600:180:1320:900",
                "-frames:v",
                "1",
                "-pix_fmt",
                "rgb24",
                "-f",
                "rawvideo",
                "-",
            ],
            check=True,
            capture_output=True,
        )
        return result.stdout

    def decode_audio(self, video_path: Path) -> array:
        result = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(video_path),
                "-map",
                "0:a:0",
                "-ac",
                "2",
                "-ar",
                "48000",
                "-acodec",
                "pcm_f32le",
                "-f",
                "f32le",
                "-",
            ],
            check=True,
            capture_output=True,
        )
        samples = array("f")
        samples.frombytes(result.stdout)
        return samples

    def count_near_color(
        self,
        frame: bytes,
        target: tuple[int, int, int],
        tolerance: int = 40,
    ) -> int:
        return sum(
            1
            for index in range(0, len(frame), 3)
            if all(abs(frame[index + offset] - target[offset]) <= tolerance for offset in range(3))
        )

    def audio_window_peak(
        self,
        samples: array,
        start_sec: float,
        end_sec: float,
    ) -> float:
        channels = 2
        sample_rate = 48000
        start = round(start_sec * sample_rate) * channels
        end = min(len(samples), round(end_sec * sample_rate) * channels)
        return max((abs(value) for value in samples[start:end]), default=0.0)

    def test_assembles_mixed_footage_and_replaces_source_audio(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source_dir = root / "daily" / "day-001" / "source"
            audio_dir = root / "audio" / "week-001"
            output = root / "daily" / "day-001" / "output" / "final_video.mp4"
            source_dir.mkdir(parents=True)
            audio_dir.mkdir(parents=True)

            self.run_ffmpeg(
                [
                    "-f", "lavfi", "-i", "color=c=0x202020:size=640x360:rate=24",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
                    "-t", "60", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", str(source_dir / "clip1.mp4"),
                ]
            )
            self.run_ffmpeg(
                [
                    "-f", "lavfi", "-i", "color=c=0x303030:size=1280x720:rate=25",
                    "-t", "60", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    str(source_dir / "clip2.mp4"),
                ]
            )
            base_track = audio_dir / "01.mp3"
            self.run_ffmpeg(
                [
                    "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100",
                    "-t", "125", "-c:a", "libmp3lame", str(base_track),
                ]
            )
            for index in range(2, 21):
                shutil.copyfile(base_track, audio_dir / f"{index:02d}.mp3")

            footage = scan_footage(source_dir, root)
            tracks = scan_audio_tracks(audio_dir, root)
            result = assemble_media(
                footage,
                tracks,
                day_number=1,
                final_path=output,
                crossfade_sec=0.05,
                prefer_nvenc=False,
                check_disk=False,
                pomodoro_focus_sec=50,
                pomodoro_break_sec=20,
            )

            self.assertTrue(output.exists())
            self.assertEqual(result.width, 1920)
            self.assertEqual(result.height, 1080)
            self.assertAlmostEqual(result.frame_rate, 30.0, places=2)
            self.assertEqual(result.video_codec, "h264")
            self.assertEqual(result.audio_codec, "aac")
            self.assertLessEqual(abs(result.duration_sec - sum(item.duration_sec for item in footage)), 2.0)
            self.assertEqual(probe_output(output), result)

            focus_frame = self.extract_timer_frame(output, 20)
            break_frame = self.extract_timer_frame(output, 55)
            self.assertGreater(self.count_near_color(focus_frame, (103, 232, 249)), 20)
            self.assertGreater(self.count_near_color(break_frame, (245, 158, 11)), 20)

            samples = self.decode_audio(output)
            for cue_start in (0.0, 50.0, 50.4, 70.0):
                with self.subTest(cue_start=cue_start):
                    self.assertGreater(
                        self.audio_window_peak(samples, cue_start, cue_start + 0.25),
                        0.02,
                    )
            self.assertLess(max(abs(value) for value in samples), 1.0)

    def test_loudnorm_analysis_reads_ffmpeg_json(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            audio = Path(temp) / "tone.wav"
            self.run_ffmpeg(
                [
                    "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000",
                    "-t", "5", "-c:a", "pcm_s16le", str(audio),
                ]
            )
            measurement = _measure_loudness(audio)
            self.assertTrue(math.isfinite(measurement.integrated_lufs))
            self.assertTrue(math.isfinite(measurement.true_peak_dbtp))


if __name__ == "__main__":
    unittest.main()
