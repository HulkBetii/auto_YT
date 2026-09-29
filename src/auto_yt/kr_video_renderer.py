# -*- coding: utf-8 -*-
"""
KOREAN YOUTUBE VIDEO RENDERER (사연만남 Radio Drama Style)
High-performance 1080p 30fps Video Renderer using FFmpeg & NVIDIA NVENC Hardware Acceleration.

Features:
- Full HD 1080p (1920x1080) Video Assembly.
- Dynamic Audio Waveform Overlay (showwaves) to ensure algorithmic freshness and active visual motion.
- Automatic Hardware Acceleration detection (h264_nvenc on NVIDIA RTX 3060, fallback to libx264).
- Seamless muxing with broadcast-mastered MP3 audio.
- Robust error handling and timeout protection.
"""

from __future__ import annotations

import os
import re
import shutil
import logging
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any, Callable

from auto_yt.kr_tts_engine import get_ffmpeg_path, get_ffprobe_path

logger = logging.getLogger("KrVideoRenderer")


def is_nvenc_available(ffmpeg_bin: str) -> bool:
    """Kiểm tra GPU NVIDIA có hỗ trợ h264_nvenc trong FFmpeg không."""
    try:
        res = subprocess.run(
            [ffmpeg_bin, "-encoders"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return "h264_nvenc" in res.stdout
    except Exception as e:
        logger.warning(f"Không kiểm tra được NVENC: {e}")
        return False


def get_media_duration(file_path: Path, ffprobe_bin: Optional[str] = None) -> float:
    """Đo thời lượng chính xác của tệp media (audio/video) bằng ffprobe."""
    probe = ffprobe_bin or get_ffprobe_path()
    try:
        cmd = [
            probe,
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(res.stdout.strip())
    except Exception as e:
        logger.warning(f"Lỗi đo duration cho {file_path}: {e}")
        return 0.0


class KrVideoRenderer:
    """
    Engine render video YouTube 1080p cho Radio Drama Hàn Quốc.
    """

    def __init__(
        self,
        ffmpeg_bin: Optional[str] = None,
        ffprobe_bin: Optional[str] = None,
        prefer_nvenc: bool = True,
    ):
        self.ffmpeg_bin = ffmpeg_bin or get_ffmpeg_path()
        self.ffprobe_bin = ffprobe_bin or get_ffprobe_path()
        self.prefer_nvenc = prefer_nvenc
        self._nvenc_supported = is_nvenc_available(self.ffmpeg_bin) if prefer_nvenc else False
        logger.info(f"KrVideoRenderer initialized. FFmpeg: {self.ffmpeg_bin}, NVENC: {self._nvenc_supported}")

    def render_audiobook_video(
        self,
        audio_path: Path,
        image_path: Path,
        output_mp4: Path,
        duration_limit_s: Optional[float] = None,
        show_waveform: bool = True,
        waveform_color: str = "0x00E5FF@0.45",
        target_fps: int = 25,
        video_bitrate: str = "2500k",
        audio_bitrate: str = "192k",
    ) -> Dict[str, Any]:
        """
        Render video 1080p kết hợp ảnh nền và audio audiobook.
        
        Args:
            audio_path: Tệp âm thanh MP3/WAV
            image_path: Ảnh nền / Thumbnail (1280x720 hoặc 1920x1080)
            output_mp4: Đường dẫn video MP4 hoàn chỉnh
            duration_limit_s: Giới hạn thời lượng (dùng cho test preview)
            show_waveform: Hiển thị sóng âm thanh động ở đáy màn hình
            waveform_color: Màu sóng âm (mặc định Cyan Neon mờ)
            target_fps: Frame rate (25-30 fps)
            video_bitrate: Bitrate video
            audio_bitrate: Bitrate audio
        """
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")
        if not image_path.exists():
            raise FileNotFoundError(f"Image file not found: {image_path}")

        output_mp4.parent.mkdir(parents=True, exist_ok=True)
        total_audio_duration = get_media_duration(audio_path, self.ffprobe_bin)

        encoder = "h264_nvenc" if self._nvenc_supported else "libx264"
        encoder_opts = ["-preset", "p4", "-tune", "hq"] if self._nvenc_supported else ["-preset", "veryfast", "-crf", "20"]

        # Xây dựng Filtergraph
        if show_waveform:
            filter_complex = (
                "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=yuv420p[bg];"
                f"[1:a]showwaves=s=1920x80:mode=cline:colors={waveform_color}:scale=cbrt,format=yuva420p[wave];"
                "[bg][wave]overlay=0:H-h-15:format=auto[v]"
            )
            map_video = "[v]"
        else:
            filter_complex = "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=yuv420p"
            map_video = "0:v"

        cmd = [
            self.ffmpeg_bin,
            "-y",
            "-loop", "1",
            "-i", str(image_path),
            "-i", str(audio_path),
        ]

        if duration_limit_s:
            cmd.extend(["-t", str(duration_limit_s)])

        if show_waveform:
            cmd.extend(["-filter_complex", filter_complex, "-map", map_video, "-map", "1:a"])
        else:
            cmd.extend(["-vf", filter_complex, "-map", map_video, "-map", "1:a"])

        cmd.extend([
            "-c:v", encoder,
            *encoder_opts,
            "-b:v", video_bitrate,
            "-r", str(target_fps),
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", audio_bitrate,
            "-shortest",
            str(output_mp4),
        ])

        logger.info(f"🚀 Bắt đầu render video 1080p ({encoder}) -> {output_mp4.name}...")
        t0 = subprocess.run(cmd, capture_output=True, text=True)

        if t0.returncode != 0:
            logger.error(f"FFmpeg render lỗi (code {t0.returncode}):\n{t0.stderr}")
            # Fallback sang CPU nếu NVENC lỗi
            if encoder == "h264_nvenc":
                logger.warning("Thử lại với encoder CPU libx264...")
                cmd_cpu = [c if c != "h264_nvenc" else "libx264" for c in cmd]
                t0 = subprocess.run(cmd_cpu, capture_output=True, text=True)
                if t0.returncode != 0:
                    raise RuntimeError(f"FFmpeg render failed: {t0.stderr[-500:]}")
            else:
                raise RuntimeError(f"FFmpeg render failed: {t0.stderr[-500:]}")

        rendered_duration = get_media_duration(output_mp4, self.ffprobe_bin)
        file_size_bytes = output_mp4.stat().st_size
        file_size_mb = round(file_size_bytes / (1024 * 1024), 2)

        logger.info(
            f"✨ HOÀN TẤT RENDER VIDEO 1080p: {output_mp4.name} "
            f"(Thời lượng: {rendered_duration/60:.2f} phút, Dung lượng: {file_size_mb} MB)"
        )

        return {
            "output_video": str(output_mp4),
            "encoder": encoder,
            "duration_seconds": rendered_duration,
            "duration_minutes": round(rendered_duration / 60, 2),
            "file_size_mb": file_size_mb,
            "resolution": "1920x1080",
            "fps": target_fps,
        }
