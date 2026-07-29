from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from array import array
from dataclasses import replace
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from assemble_study_video import (  # noqa: E402
    AssemblyError,
    AudioTrackInfo,
    _audio_filter,
    _video_filter,
    build_audio_sequence,
    build_pomodoro_cue_schedule,
    build_pomodoro_duck_windows,
    compute_input_signature,
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


class HelperTests(unittest.TestCase):
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
        self.assertEqual(week_number_for_day(100), 15)
        with self.assertRaises(AssemblyError):
            week_number_for_day(101)

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
        self.assertEqual(len(sequence), 4)
        effective_duration = sum(item.duration_sec for item in sequence) - 3 * (len(sequence) - 1)
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
        effective_duration = sum(item.duration_sec for item in sequence) - 3 * (len(sequence) - 1)
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
            "4eeb8138cbd0addca0959929d0eeb2a520aff646b7c49d97a240ff4ca7faad1c",
        )
        self.assertNotEqual(
            first,
            compute_input_signature(
                1,
                1,
                ["a", "b"],
                ["c", "d"],
                assembly_profile="study-pomodoro-v2",
            ),
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
        video_filter = _video_filter(1, 4, 2, Path("C:/Windows/Fonts/consolab.ttf"))
        self.assertIn("fontcolor=0x67E8F9", video_filter)
        self.assertIn("fontcolor=0xF59E0B", video_filter)
        self.assertIn("boxcolor=black@0.65", video_filter)
        self.assertIn("x=w-tw-48-18:y=h-th-48-18", video_filter)
        self.assertIn("FOCUS", video_filter)
        self.assertIn("BREAK", video_filter)

        audio_filter = _audio_filter(1, 7, 0.05, 4, 2)
        self.assertIn("sin(2*PI*880*t)", audio_filter)
        self.assertIn("sin(2*PI*660*t)", audio_filter)
        self.assertIn("adelay=4000|4000", audio_filter)
        self.assertIn("adelay=4400|4400", audio_filter)
        self.assertIn("volume=volume=0.630957", audio_filter)
        self.assertIn("alimiter=limit=0.891251", audio_filter)

    def test_encoder_arguments(self) -> None:
        self.assertIn("h264_nvenc", encoder_args(True))
        self.assertIn("libx264", encoder_args(False))


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
                    "-t", "1.2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", str(source_dir / "clip1.mp4"),
                ]
            )
            self.run_ffmpeg(
                [
                    "-f", "lavfi", "-i", "color=c=0x303030:size=1280x720:rate=25",
                    "-t", "1.1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    str(source_dir / "clip2.mp4"),
                ]
            )
            base_track = audio_dir / "01.mp3"
            self.run_ffmpeg(
                [
                    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                    "-t", "0.35", "-c:a", "libmp3lame", str(base_track),
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
                pomodoro_focus_sec=1,
                pomodoro_break_sec=1,
            )

            self.assertTrue(output.exists())
            self.assertEqual(result.width, 1920)
            self.assertEqual(result.height, 1080)
            self.assertAlmostEqual(result.frame_rate, 30.0, places=2)
            self.assertEqual(result.video_codec, "h264")
            self.assertEqual(result.audio_codec, "aac")
            self.assertLessEqual(abs(result.duration_sec - sum(item.duration_sec for item in footage)), 2.0)
            self.assertEqual(probe_output(output), result)

            focus_frame = self.extract_timer_frame(output, 0.5)
            break_frame = self.extract_timer_frame(output, 1.5)
            self.assertGreater(self.count_near_color(focus_frame, (103, 232, 249)), 20)
            self.assertGreater(self.count_near_color(break_frame, (245, 158, 11)), 20)

            samples = self.decode_audio(output)
            for cue_start in (0.0, 1.0, 1.4, 2.0):
                with self.subTest(cue_start=cue_start):
                    self.assertGreater(
                        self.audio_window_peak(samples, cue_start, cue_start + 0.25),
                        0.02,
                    )
            self.assertLess(max(abs(value) for value in samples), 1.0)


if __name__ == "__main__":
    unittest.main()
