"""
YouTube content extractor for web_ko_jp pipeline.
Extracts title, video metadata, and formatted transcript with timestamps: (mm:ss) text.
Fallback to faster-whisper on GPU if no subtitles/captions are available.
"""
import sys
import os
import json
import re
import urllib.request
import tempfile
from pathlib import Path
from typing import Dict, Any, List

sys.stdout.reconfigure(encoding="utf-8")

def format_timestamp(seconds: float) -> str:
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"({mins:02d}:{secs:02d})"

def extract_captions_from_json3(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    
    lines = []
    events = data.get("events", [])
    for ev in events:
        t_ms = ev.get("tStartMs", 0)
        t_sec = t_ms / 1000.0
        time_tag = format_timestamp(t_sec)
        segs = ev.get("segs", [])
        text = "".join(s.get("utf8", "") for s in segs).strip()
        # Clean line breaks inside seg text
        text = re.sub(r"\s+", " ", text)
        if text:
            lines.append(f"{time_tag} {text}")
    return "\n".join(lines)

def transcribe_with_whisper(audio_path: str) -> str:
    print("[youtube_extractor] Falling back to faster-whisper on GPU...", file=sys.stderr)
    from faster_whisper import WhisperModel
    model = WhisperModel("large-v3", device="cuda", compute_type="float16")
    segments, _ = model.transcribe(audio_path, beam_size=5)
    lines = []
    for s in segments:
        time_tag = format_timestamp(s.start)
        text = s.text.strip()
        if text:
            lines.append(f"{time_tag} {text}")
    return "\n".join(lines)

def extract_youtube_info(video_url: str) -> Dict[str, Any]:
    from yt_dlp import YoutubeDL
    
    ydl_opts = {
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["all"],
        "extractor_args": {
            "youtube": {
                "player_client": ["ios", "android", "web"]
            }
        },
        "quiet": True,
        "no_warnings": True,
    }
    
    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(video_url, download=False)
        
    title = str(info.get("title") or "YouTube Video").strip()
    video_id = info.get("id")
    webpage_url = str(info.get("webpage_url") or f"https://www.youtube.com/watch?v={video_id}")
    duration = info.get("duration") or 0
    
    # Priority for caption languages: vi, ko, ja, en, or first available
    subtitles = info.get("subtitles") or {}
    auto_captions = info.get("automatic_captions") or {}
    
    transcript_text = ""
    chosen_lang = None
    
    # Check manual subtitles first, then automatic
    lang_priority = ["vi", "ko", "ja", "en"]
    for lang in lang_priority:
        if lang in subtitles:
            tracks = subtitles[lang]
            json3 = next((t["url"] for t in tracks if t.get("ext") == "json3"), None)
            if json3:
                try:
                    transcript_text = extract_captions_from_json3(json3)
                    chosen_lang = lang
                    break
                except Exception as e:
                    print(f"Error fetching json3 for manual {lang}: {e}", file=sys.stderr)
                    
    if not transcript_text:
        for lang in lang_priority:
            if lang in auto_captions:
                tracks = auto_captions[lang]
                json3 = next((t["url"] for t in tracks if t.get("ext") == "json3"), None)
                if json3:
                    try:
                        transcript_text = extract_captions_from_json3(json3)
                        chosen_lang = f"{lang}-auto"
                        break
                    except Exception as e:
                        print(f"Error fetching json3 for auto {lang}: {e}", file=sys.stderr)

    # If still not found, try any available auto caption
    if not transcript_text and auto_captions:
        for lang, tracks in auto_captions.items():
            json3 = next((t["url"] for t in tracks if t.get("ext") == "json3"), None)
            if json3:
                try:
                    transcript_text = extract_captions_from_json3(json3)
                    chosen_lang = f"{lang}-auto"
                    break
                except Exception:
                    pass

    # Fallback to audio download + Whisper if completely missing
    if not transcript_text:
        print("[youtube_extractor] No captions found online. Downloading audio for Whisper...", file=sys.stderr)
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_out = os.path.join(tmpdir, "audio.wav")
            audio_opts = {
                "format": "bestaudio/best",
                "outtmpl": os.path.join(tmpdir, "audio.%(ext)s"),
                "postprocessors": [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "wav",
                    "preferredquality": "192",
                }],
                "quiet": True,
            }
            with YoutubeDL(audio_opts) as ydl:
                ydl.download([video_url])
            # Find the generated wav file
            wav_files = list(Path(tmpdir).glob("*.wav"))
            if wav_files:
                transcript_text = transcribe_with_whisper(str(wav_files[0]))
                chosen_lang = "whisper-gpu"

    return {
        "title": title,
        "video_id": video_id,
        "url": webpage_url,
        "duration_seconds": duration,
        "caption_language": chosen_lang,
        "transcript": transcript_text,
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python youtube_extractor.py <youtube_url>")
        sys.exit(1)
        
    url = sys.argv[1]
    res = extract_youtube_info(url)
    print(json.dumps(res, ensure_ascii=False, indent=2))