"""
timestamp_sync.py
=================
Dynamic Chapter & Timestamp Synchronization Engine for web_ko_jp pipeline.
Analyzes Japanese SRT subtitles and automatically synchronizes chapter titles
with exact audio timestamps, producing a strictly ascending chapter list starting at 00:00.
"""
import re
from pathlib import Path
from typing import List, Tuple, Dict, Any, Optional

NUMBER_KANJI_MAP = {
    "1": ["一つ目", "１つ目", "1つ目", "第一", "第1", "まず一つ", "一つ目は", "初めに"],
    "2": ["二つ目", "２つ目", "2つ目", "第二", "第2", "二つ目は", "次に"],
    "3": ["三つ目", "３つ目", "3つ目", "第三", "第3", "三つ目は"],
    "4": ["四つ目", "４つ目", "4つ目", "第四", "第4", "四つ目は"],
    "5": ["五つ目", "５つ目", "5つ目", "第五", "第5", "五つ目は"],
    "6": ["六つ目", "６つ目", "6つ目", "第六", "第6", "六つ目は"],
    "7": ["七つ目", "７つ目", "7つ目", "第七", "第7", "七つ目は"],
    "8": ["八つ目", "８つ目", "8つ目", "第八", "第8", "八つ目は"],
    "9": ["九つ目", "９つ目", "9つ目", "第九", "第9", "九つ目は"],
    "10": ["十つ目", "１０つ目", "10つ目", "第十", "第10", "十個目"],
}

# Generic closing phrases only. Lines quoted from one past script ("ふざけるな", "自分の人生を守れ")
# matched nothing in other scripts and silently pushed chapters onto interpolated timestamps.
SUMMARY_KEYWORDS = ["まとめ", "最後に", "結び", "おわりに", "ここまで話した"]
INTERPOLATION_MAX_STEP_SEC = 90.0


def parse_timestamp_sec(ts_str: str) -> float:
    """Converts 00:01:23,456 or 01:23 to seconds."""
    ts_str = ts_str.strip().replace(",", ".")
    parts = ts_str.split(":")
    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    elif len(parts) == 2:
        m, s = parts
        return int(m) * 60 + float(s)
    return float(ts_str)


def format_timestamp(seconds: float) -> str:
    """Formats seconds into MM:SS (or HH:MM:SS if > 1 hour)."""
    sec = int(seconds)
    h = sec // 3600
    m = (sec % 3600) // 60
    s = sec % 60
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def parse_srt_file(srt_path: Path) -> List[Dict[str, Any]]:
    """Parses SRT file into a list of cues: [{index, start_sec, end_sec, text}]."""
    if not srt_path.exists():
        return []
    content = srt_path.read_text(encoding="utf-8")
    blocks = re.findall(
        r"(\d+)\r?\n(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})\r?\n([\s\S]*?)(?=\n\r?\n|\Z)",
        content
    )
    cues = []
    for idx_str, start_ts, end_ts, text in blocks:
        cues.append({
            "index": int(idx_str),
            "start_sec": parse_timestamp_sec(start_ts),
            "end_sec": parse_timestamp_sec(end_ts),
            "text": text.strip().replace("\n", " "),
        })
    return cues


def extract_raw_chapter_lines(description_jp: str) -> List[str]:
    """Extracts lines under ▼目次 or ◆ 目次 or 【目次】 from description."""
    lines = []
    in_toc = False
    for line in description_jp.splitlines():
        stripped = line.strip()
        if re.search(r"[▼◆【]\s*(?:目次|チャプター|Chapters)", stripped, re.IGNORECASE):
            in_toc = True
            continue
        if in_toc:
            if not stripped or stripped.startswith("【") or stripped.startswith("▼このチャンネル"):
                break
            # Match lines that look like a chapter
            if re.search(r"^(?:\d{2}:\d{2}|XX:XX|[①-⑩0-9])", stripped) or "｜" in stripped or "・" in stripped:
                lines.append(stripped)
    return lines


def find_keywords_for_chapter(chapter_title: str, index: int, total: int) -> List[str]:
    """Derives search keywords from chapter title and position."""
    keywords = []
    # Check if intro
    # The intro is always 00:00 and never searched.
    if index == 0:
        return []

    # Check if conclusion / summary
    # Closing chapters also try their own nouns below: generic closers alone rarely occur verbatim.
    if index == total - 1 or "まとめ" in chapter_title or "最後に" in chapter_title or "おわりに" in chapter_title:
        keywords.extend(SUMMARY_KEYWORDS)

    # Look for numbered items (①, 1, 一つ目...)
    num_match = re.search(r"([①-⑩0-9]+)", chapter_title)
    if num_match:
        raw_num = num_match.group(1)
        # Convert circled number to digit string
        circled = "①②③④⑤⑥⑦⑧⑨⑩"
        if raw_num in circled:
            digit = str(circled.index(raw_num) + 1)
        else:
            digit = raw_num
        if digit in NUMBER_KANJI_MAP:
            keywords.extend(NUMBER_KANJI_MAP[digit])

    # Extract meaningful Japanese nouns / phrases (2-6 chars)
    words = re.findall(r"[\u4e00-\u9fff\u3040-\u30ff]{2,6}", chapter_title)
    for w in words:
        if w not in ["特徴", "人間", "理由", "チャプター", "目次"]:
            keywords.append(w)

    return keywords


def sync_chapters_detailed(
    description_jp: str,
    srt_path: Path,
    audio_duration_sec: Optional[float] = None
) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Matches chapter definitions in description_jp against SRT subtitles and returns
    (updated_description, [{title, seconds, source}]) where source is "start", "matched" or
    "interpolated" (no subtitle cue matched; the timestamp is a proportional guess).
    """
    cues = parse_srt_file(srt_path)
    if not cues and not audio_duration_sec:
        return description_jp, []

    total_duration = audio_duration_sec or (cues[-1]["end_sec"] if cues else 600.0)
    raw_lines = extract_raw_chapter_lines(description_jp)

    if not raw_lines:
        return description_jp, []

    total_chapters = len(raw_lines)
    chapters: List[Dict[str, Any]] = []
    last_sec = 0.0

    for i, line in enumerate(raw_lines):
        # Strip existing timestamp or prefix
        clean_title = re.sub(r"^(?:\d{1,2}:\d{2}(?::\d{2})?|XX:XX)\s*", "", line).strip()
        if not clean_title:
            continue

        if i == 0:
            # First chapter is strictly 00:00
            chapters.append({"title": clean_title, "seconds": 0.0, "source": "start"})
            last_sec = 0.0
            continue

        # Search in cues after last_sec
        kws = find_keywords_for_chapter(clean_title, i, total_chapters)
        matched_sec = None

        if cues:
            for cue in cues:
                if cue["start_sec"] >= last_sec:
                    if any(kw in cue["text"] for kw in kws):
                        matched_sec = cue["start_sec"]
                        break

        source = "matched"
        # Fallback if no cue matched: proportional interpolation
        if matched_sec is None or matched_sec <= last_sec:
            proportional_step = (total_duration - last_sec) / max(total_chapters - i, 1)
            matched_sec = last_sec + min(proportional_step, INTERPOLATION_MAX_STEP_SEC)
            source = "interpolated"

        last_sec = matched_sec
        chapters.append({"title": clean_title, "seconds": matched_sec, "source": source})

    synchronized_chapters = [f"{format_timestamp(ch['seconds'])} {ch['title']}" for ch in chapters]
    return _replace_toc(description_jp, synchronized_chapters), chapters


def sync_chapters_with_srt(
    description_jp: str,
    srt_path: Path,
    audio_duration_sec: Optional[float] = None
) -> Tuple[str, List[str]]:
    """
    Matches chapter definitions in description_jp against SRT subtitles,
    computes accurate timestamps, and returns (updated_description, synchronized_chapters).
    """
    updated_desc, chapters = sync_chapters_detailed(description_jp, srt_path, audio_duration_sec)
    return updated_desc, [f"{format_timestamp(ch['seconds'])} {ch['title']}" for ch in chapters]


def _replace_toc(description_jp: str, synchronized_chapters: List[str]) -> str:
    # Build the updated TOC block
    toc_block = "▼目次\n" + "\n".join(synchronized_chapters)

    # Replace the existing TOC block in description_jp
    updated_desc = re.sub(
        r"[▼◆【]\s*(?:目次|チャプター|Chapters)[\s\S]*?(?=(?:【|▼このチャンネル|#|\Z))",
        toc_block + "\n\n",
        description_jp
    ).strip()

    return updated_desc
