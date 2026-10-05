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
MIN_CHAPTER_GAP_SEC = 10.0
CIRCLED_NUMBERS = "①②③④⑤⑥⑦⑧⑨⑩"
GENERIC_TITLE_WORDS = {"特徴", "人間", "理由", "チャプター", "目次"}
_ORDINAL_TERMS = {v for variants in NUMBER_KANJI_MAP.values() for v in variants if "目" in v}


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
            if re.search(r"^(?:\d{2}:\d{2}|XX(?:[:：]XX)?\s|[①-⑩0-9])", stripped) or "｜" in stripped or "・" in stripped:
                lines.append(stripped)
    return lines


def is_closing_chapter(chapter_title: str, index: int, total: int) -> bool:
    return index == total - 1 or any(k in chapter_title for k in ("まとめ", "最後に", "おわりに", "結び"))


def chapter_search_terms(chapter_title: str, index: int, total: int) -> Tuple[List[str], List[str]]:
    """
    (strong, weak) subtitle search terms for a chapter.
    Strong: the script's own ordinal (三つ目), phrases quoted in 「」 (the narration says them
    verbatim) and, for the closing chapter, generic closers. Weak: kanji/katakana words of the
    title, tried only when no strong term matches. Bare hiragana fragments ("るの", "けど") are
    never used: on v6 they matched unrelated lines and pulled chapters minutes early.
    """
    if index == 0:  # the intro is always 00:00 and never searched
        return [], []
    strong: List[str] = []
    weak: List[str] = []

    if is_closing_chapter(chapter_title, index, total):
        strong.extend(SUMMARY_KEYWORDS)

    num_match = re.search(r"([①-⑩]|\d+)", chapter_title)
    if num_match:
        raw_num = num_match.group(1)
        digit = str(CIRCLED_NUMBERS.index(raw_num) + 1) if raw_num in CIRCLED_NUMBERS else raw_num
        for variant in NUMBER_KANJI_MAP.get(digit, []):
            (strong if "目" in variant else weak).append(variant)

    strong.extend(re.findall(r"「([^」]{2,})」", chapter_title))
    for word in re.findall(r"[一-鿿゠-ヿ]{2,}", chapter_title):
        if word not in GENERIC_TITLE_WORDS:
            weak.append(word)
    return strong, weak


def find_keywords_for_chapter(chapter_title: str, index: int, total: int) -> List[str]:
    """Derives search keywords from chapter title and position (strong terms first)."""
    strong, weak = chapter_search_terms(chapter_title, index, total)
    return strong + weak


def _first_cue(cues: List[Dict[str, Any]], terms: List[str], from_end: bool) -> Optional[float]:
    for cue in (reversed(cues) if from_end else cues):
        if any(term in cue["text"] for term in terms):
            return cue["start_sec"]
    return None


def sync_chapters_detailed(
    description_jp: str,
    srt_path: Path,
    audio_duration_sec: Optional[float] = None
) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Matches chapter definitions in description_jp against SRT subtitles and returns
    (updated_description, [{title, seconds, source}]) where source is "start", "matched" or
    "interpolated" (no subtitle cue matched; the timestamp is a proportional guess).

    Three passes, because chapter titles are ChatGPT paraphrases while ordinals are said verbatim:
      1. anchors: the script's ordinal (三つ目) or, for the closing chapter, its last closer phrase;
         kept only while strictly increasing.
      2. the remaining chapters take the earliest cue with a 「」 phrase or title word, searched only
         between their neighbours (v7: 「正直だから」 also occurs in the 20:31 recap).
      3. still unmatched chapters are spread evenly between their neighbours.
    """
    cues = parse_srt_file(srt_path)
    if not cues and not audio_duration_sec:
        return description_jp, []

    total_duration = audio_duration_sec or (cues[-1]["end_sec"] if cues else 600.0)
    raw_lines = extract_raw_chapter_lines(description_jp)

    if not raw_lines:
        return description_jp, []

    titles = [
        t for t in (re.sub(r"^(?:\d{1,2}:\d{2}(?::\d{2})?|XX(?:[:：]XX)?)\s*", "", line).strip() for line in raw_lines)
        if t
    ]
    total = len(titles)
    times: List[Optional[float]] = [0.0] + [None] * (total - 1)
    sources: List[str] = ["start"] + ["interpolated"] * (total - 1)
    terms = [chapter_search_terms(t, i, total) for i, t in enumerate(titles)]

    # Pass 1: anchors.
    last_anchor = 0.0
    for i in range(1, total):
        strong, _ = terms[i]
        after = [c for c in cues if c["start_sec"] >= last_anchor + MIN_CHAPTER_GAP_SEC]
        if is_closing_chapter(titles[i], i, total):
            hit = _first_cue(after, [k for k in strong if k in SUMMARY_KEYWORDS], from_end=True)
        else:
            hit = _first_cue(after, [k for k in strong if k in _ORDINAL_TERMS], from_end=False)
        if hit is not None:
            times[i], sources[i], last_anchor = hit, "matched", hit

    # Pass 2: earliest quote / title word between the neighbours.
    for i in range(1, total):
        if times[i] is not None:
            continue
        low = times[i - 1] + MIN_CHAPTER_GAP_SEC if times[i - 1] is not None else None
        high = next((times[j] for j in range(i + 1, total) if times[j] is not None), total_duration)
        if low is None:
            continue
        strong, weak = terms[i]
        phrases = [k for k in strong if k not in _ORDINAL_TERMS and k not in SUMMARY_KEYWORDS] + weak
        if is_closing_chapter(titles[i], i, total):
            phrases = []  # title nouns recur everywhere (v5 put the summary 19s before the end)
        window = [c for c in cues if low <= c["start_sec"] <= high - MIN_CHAPTER_GAP_SEC]
        hit = _first_cue(window, phrases, from_end=False)
        if hit is not None:
            times[i], sources[i] = hit, "matched"

    # Pass 3: spread the rest evenly between known neighbours.
    i = 1
    while i < total:
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < total and times[j] is None:
            j += 1
        left = times[i - 1]
        right = times[j] if j < total else total_duration
        step = (right - left) / (j - i + 1)
        if j == total:
            step = min(step, INTERPOLATION_MAX_STEP_SEC)
        for k in range(i, j):
            times[k] = left + step * (k - i + 1)
        i = j

    chapters = [{"title": t, "seconds": s, "source": src} for t, s, src in zip(titles, times, sources)]
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
