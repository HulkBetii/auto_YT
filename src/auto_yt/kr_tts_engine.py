# -*- coding: utf-8 -*-
"""
KOREAN TTS & VOICE SYNTHESIS ENGINE
High-performance async Text-to-Speech synthesis for Korean Radio Drama / Sayeon Audiobooks.

Features:
- Smart Korean sentence chunking (preserves Korean particles, quotes, and punctuation).
- Async concurrent batch synthesis with rate-limiting semaphore.
- Automatic FFmpeg discovery and seamless audio stitching with concat demuxer.
- Optional EBU R128 Loudness Normalization (-16 LUFS) for professional broadcast audio.
- Support for Microsoft Neural Voices (ko-KR-SunHiNeural, ko-KR-InJoonNeural) and Reference Voice Profiles.
"""

from __future__ import annotations

import os
import re
import json
import shutil
import asyncio
import logging
import tempfile
import subprocess
from pathlib import Path
from typing import Optional, List, Dict, Any, Callable

import edge_tts
from auto_yt.paths import DATA_DIR, PROJECT_ROOT

logger = logging.getLogger("KrTtsEngine")

DEFAULT_FEMALE_VOICE = "ko-KR-SunHiNeural"
DEFAULT_MALE_VOICE = "ko-KR-InJoonNeural"
VOICE_REFERENCE_DIR = DATA_DIR / "voice_reference"


def get_ffmpeg_path() -> str:
    """Tự động tìm kiếm đường dẫn thực thi của ffmpeg.exe trên Windows."""
    # 1. Kiểm tra PATH hệ thống
    which_ffmpeg = shutil.which("ffmpeg")
    if which_ffmpeg:
        return which_ffmpeg

    # 2. Kiểm tra WinGet packages
    winget_base = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    if winget_base.exists():
        found = list(winget_base.glob("**/ffmpeg.exe"))
        if found:
            return str(found[0])

    # 3. Kiểm tra CapCut apps
    capcut_base = Path(os.environ.get("LOCALAPPDATA", "")) / "CapCut" / "Apps"
    if capcut_base.exists():
        found = list(capcut_base.glob("**/ffmpeg.exe"))
        if found:
            return str(found[0])

    # 4. Fallback mặc định
    return "ffmpeg"


def get_ffprobe_path() -> str:
    """Tự động tìm kiếm đường dẫn thực thi của ffprobe.exe trên Windows."""
    which_ffprobe = shutil.which("ffprobe")
    if which_ffprobe:
        return which_ffprobe

    winget_base = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    if winget_base.exists():
        found = list(winget_base.glob("**/ffprobe.exe"))
        if found:
            return str(found[0])

    return "ffprobe"


def chunk_korean_text(text: str, max_chars: int = 280) -> List[str]:
    """
    Chia nhỏ văn bản tiếng Hàn dài thành các chunk tự nhiên theo đoạn và câu.
    Đảm bảo không cắt ngang câu hoặc cụm từ cảm xúc.
    """
    # 1. Chuẩn hóa khoảng trắng và bỏ các thẻ markdown thừa
    cleaned = re.sub(r'\[SPEAKER:[^\]]+\]\s*', '', text)
    cleaned = re.sub(r'#{1,6}\s+.*?\n', '', cleaned)
    
    # 2. Tách theo đoạn văn
    paragraphs = [p.strip() for p in cleaned.split("\n") if p.strip()]
    
    chunks: List[str] = []
    
    for para in paragraphs:
        if len(para) <= max_chars:
            chunks.append(para)
            continue
            
        # Nếu đoạn quá dài, tách theo dấu câu tiếng Hàn (. ? ! ~ …)
        sentences = re.split(r'((?<=[.?!~…])\s+|(?<=[”"\'’])\s+)', para)
        current_chunk = ""
        
        for part in sentences:
            if not part:
                continue
            if len(current_chunk) + len(part) <= max_chars:
                current_chunk += part
            else:
                if current_chunk.strip():
                    chunks.append(current_chunk.strip())
                current_chunk = part
                
        if current_chunk.strip():
            chunks.append(current_chunk.strip())
            
    # Lọc bỏ các chunk rỗng
    return [c for c in chunks if c.strip()]


class KrTtsEngine:
    """
    Engine TTS Tiếng Hàn hiệu năng cao, hỗ trợ audio dài và chuẩn hóa âm thanh EBU R128.
    """

    def __init__(
        self,
        default_voice: str = DEFAULT_FEMALE_VOICE,
        concurrency: int = 5,
        ffmpeg_bin: Optional[str] = None,
    ):
        self.default_voice = default_voice
        self.semaphore = asyncio.Semaphore(concurrency)
        self.ffmpeg_bin = ffmpeg_bin or get_ffmpeg_path()
        self.ffprobe_bin = get_ffprobe_path()

    async def synthesize_text(
        self,
        text: str,
        output_file: Path,
        voice: Optional[str] = None,
        rate: str = "+0%",
        pitch: str = "+0Hz",
        normalize_loudness: bool = True,
    ) -> Dict[str, Any]:
        """
        Tổng hợp một đoạn văn bản ngắn thành tệp audio MP3.
        """
        output_file.parent.mkdir(parents=True, exist_ok=True)
        selected_voice = voice or self.default_voice
        
        communicate = edge_tts.Communicate(text, selected_voice, rate=rate, pitch=pitch)
        
        if not normalize_loudness:
            await communicate.save(str(output_file))
        else:
            # Lưu tạm rồi chuẩn hóa loudness
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                tmp_path = Path(tmp.name)
            try:
                await communicate.save(str(tmp_path))
                self._normalize_audio_file(tmp_path, output_file)
            finally:
                if tmp_path.exists():
                    tmp_path.unlink()

        duration = self.get_audio_duration(output_file)
        return {
            "output_file": str(output_file),
            "voice": selected_voice,
            "duration_seconds": duration,
            "char_count": len(text),
        }

    async def synthesize_audiobook(
        self,
        text_or_file: str | Path,
        output_file: Path,
        voice: Optional[str] = None,
        rate: str = "+0%",
        pitch: str = "+0Hz",
        max_chunk_chars: int = 280,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> Dict[str, Any]:
        """
        Tổng hợp toàn bộ kịch bản Audiobook dài (60-90 phút) thành 1 tệp MP3 chất lượng cao.
        Tự động chunking song song, ghép nối bằng FFmpeg và chuẩn hóa âm lượng.
        """
        if isinstance(text_or_file, Path) or (isinstance(text_or_file, str) and os.path.exists(text_or_file)):
            raw_text = Path(text_or_file).read_text(encoding="utf-8")
        else:
            raw_text = str(text_or_file)

        chunks = chunk_korean_text(raw_text, max_chars=max_chunk_chars)
        total_chunks = len(chunks)
        selected_voice = voice or self.default_voice

        logger.info(
            f"🎙️ [KrTtsEngine] Bắt đầu tổng hợp Audiobook: {len(raw_text)} ký tự -> {total_chunks} chunks (Voice: {selected_voice})"
        )

        output_file.parent.mkdir(parents=True, exist_ok=True)

        with tempfile.TemporaryDirectory() as tmp_dir_str:
            tmp_dir = Path(tmp_dir_str)
            chunk_files: List[Path] = [tmp_dir / f"chunk_{i:05d}.mp3" for i in range(total_chunks)]

            # Async worker cho từng chunk
            async def _synthesize_single_chunk(index: int, chunk_text: str, chunk_out: Path):
                async with self.semaphore:
                    comm = edge_tts.Communicate(chunk_text, selected_voice, rate=rate, pitch=pitch)
                    # Retry tối đa 3 lần nếu có lỗi mạng
                    for attempt in range(3):
                        try:
                            await comm.save(str(chunk_out))
                            break
                        except Exception as err:
                            if attempt == 2:
                                raise err
                            await asyncio.sleep(1.0)

                    if progress_callback:
                        progress_callback(index + 1, total_chunks)

            # Chạy song song tất cả các chunks
            tasks = [
                _synthesize_single_chunk(i, chunks[i], chunk_files[i])
                for i in range(total_chunks)
            ]
            await asyncio.gather(*tasks)

            # Ghép tất cả các chunk bằng FFmpeg Concat Demuxer
            concat_list_file = tmp_dir / "concat_list.txt"
            with open(concat_list_file, "w", encoding="utf-8") as f:
                for chunk_file in chunk_files:
                    f.write(f"file '{chunk_file.as_posix()}'\n")

            unnormalized_output = tmp_dir / "combined_raw.mp3"
            stitch_cmd = [
                self.ffmpeg_bin,
                "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_list_file),
                "-c", "copy",
                str(unnormalized_output),
            ]

            logger.info("🔗 [KrTtsEngine] Đang ghép các chunk âm thanh bằng FFmpeg...")
            res = subprocess.run(stitch_cmd, capture_output=True, text=True)
            if res.returncode != 0:
                raise RuntimeError(f"FFmpeg concat failed: {res.stderr}")

            # Chuẩn hóa âm lượng EBU R128 (-16 LUFS)
            logger.info("🎚️ [KrTtsEngine] Chuẩn hóa âm lượng EBU R128 (-16 LUFS)...")
            self._normalize_audio_file(unnormalized_output, output_file)

        duration = self.get_audio_duration(output_file)
        file_size_mb = round(output_file.stat().st_size / (1024 * 1024), 2)

        logger.info(
            f"✨ [KrTtsEngine] HOÀN TẤT TỔNG HỢP AUDIOBOOK: {output_file.name} "
            f"({duration / 60:.1f} phút, {file_size_mb} MB)"
        )

        return {
            "output_file": str(output_file),
            "voice": selected_voice,
            "total_chunks": total_chunks,
            "total_chars": len(raw_text),
            "duration_seconds": duration,
            "duration_minutes": round(duration / 60, 2),
            "file_size_mb": file_size_mb,
        }

    def _normalize_audio_file(self, input_file: Path, output_file: Path) -> None:
        """Chuẩn hóa âm lượng âm thanh theo tiêu chuẩn podcast/radio YouTube (-16 LUFS)."""
        cmd = [
            self.ffmpeg_bin,
            "-y",
            "-i", str(input_file),
            "-af", "loudnorm=I=-16:LRA=11:TP=-1.5",
            "-b:a", "192k",
            str(output_file),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            logger.warning(f"Loudnorm failed: {res.stderr}, sao chép tệp trực tiếp.")
            shutil.copyfile(input_file, output_file)

    def get_audio_duration(self, audio_file: Path) -> float:
        """Đo thời lượng chính xác của tệp âm thanh bằng ffprobe."""
        try:
            cmd = [
                self.ffprobe_bin,
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(audio_file),
            ]
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode == 0 and res.stdout.strip():
                return float(res.stdout.strip())
        except Exception as e:
            logger.warning(f"Không thể đo duration bằng ffprobe: {e}")
        return 0.0


# Singleton helper
_tts_engine_instance: Optional[KrTtsEngine] = None

def get_kr_tts_engine() -> KrTtsEngine:
    global _tts_engine_instance
    if _tts_engine_instance is None:
        _tts_engine_instance = KrTtsEngine()
    return _tts_engine_instance
