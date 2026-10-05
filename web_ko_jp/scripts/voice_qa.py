"""
voice_qa.py
===========
Checks how well the TTS narration says the script: Whisper transcribes the audio WITHOUT the script
(the SRT cannot be used: generate_srt.py replaces Whisper's words with the script), both texts are
converted to kana readings with pyopenjtalk, and the readings are aligned.

Why: v8 (2026-10-05) read 76% of the script's kana as written; sentence onsets were swallowed
(これが現実だ -> 現実だ, 使える -> 帰る) and short words garbled (車を出す -> 投げ物を出す).
The SRT looked perfect because it is the script itself.

Runs in the GPT-SoVITS venv (faster_whisper + pyopenjtalk); the uv env has neither:
    <GPT-SoVITS>/.venv/Scripts/python.exe web_ko_jp/scripts/voice_qa.py --audio X.wav --script_file S.txt --output voice_qa.json
"""
import argparse
import difflib
import json
import os
import re
import sys
from pathlib import Path
from typing import Callable, Dict, List, Sequence

KANA_RE = re.compile(r"[^゠-ヿー]")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？」])|\n+")
ONSET_KANA = 3                 # sentence onset = its first N kana
FLAG_BELOW = 0.75              # a sentence is flagged when < 75% of its kana were heard as written
MIN_FLAG_KANA = 4              # ignore 1-3 kana interjections
ASR_MODEL = "large-v3-turbo"


def split_sentences(script: str) -> List[str]:
    return [p.strip() for p in SENTENCE_SPLIT_RE.split(script) if p and p.strip()]


def compare_readings(
    script: str,
    segments: Sequence[Dict],
    reading: Callable[[str], str],
) -> Dict:
    """segments: [{start, end, text}] from ASR. Returns reading/onset match and flagged sentences
    with the approximate time where the listener should check."""
    sentences = split_sentences(script)
    sent_readings = [reading(s) for s in sentences]
    script_r = "".join(sent_readings)

    heard_chars: List[str] = []
    heard_times: List[float] = []
    for seg in segments:
        r = reading(seg["text"])
        for k, ch in enumerate(r):
            heard_chars.append(ch)
            heard_times.append(seg["start"] + (seg["end"] - seg["start"]) * k / max(len(r), 1))
    heard_r = "".join(heard_chars)

    matched = [False] * len(script_r)
    to_heard: List = [None] * len(script_r)
    for block in difflib.SequenceMatcher(None, script_r, heard_r, autojunk=False).get_matching_blocks():
        for k in range(block.size):
            matched[block.a + k] = True
            to_heard[block.a + k] = block.b + k

    flagged, onset_ok, onset_total, pos = [], 0, 0, 0
    last_time = 0.0
    for sent, r in zip(sentences, sent_readings):
        span = range(pos, pos + len(r))
        pos += len(r)
        if not r:
            continue
        hits = [to_heard[i] for i in span if to_heard[i] is not None]
        if hits:
            last_time = heard_times[min(hits[0], len(heard_times) - 1)]
        onset_total += 1
        onset_ok += all(matched[i] for i in list(span)[:ONSET_KANA])
        ratio = sum(matched[i] for i in span) / len(r)
        if ratio < FLAG_BELOW and len(r) >= MIN_FLAG_KANA:
            flagged.append({"time": round(last_time, 1), "sentence": sent, "match": round(ratio, 2)})

    return {
        "reading_match": round(sum(matched) / max(len(script_r), 1), 3),
        "onset_match": round(onset_ok / max(onset_total, 1), 3),
        "script_kana": len(script_r),
        "heard_kana": len(heard_r),
        "flagged": flagged,
    }


def _kana_reading(text: str) -> str:
    import pyopenjtalk
    return KANA_RE.sub("", pyopenjtalk.g2p(text, kana=True))


def transcribe(audio: str) -> List[Dict]:
    try:
        import torch
        os.add_dll_directory(str(Path(torch.__file__).parent / "lib"))
    except Exception:  # CPU-only env: CTranslate2 still loads, just slower
        pass
    from faster_whisper import WhisperModel

    try:
        model = WhisperModel(ASR_MODEL, device="cuda", compute_type="float16")
    except Exception as err:
        print(f"[voice_qa] CUDA unavailable ({err}); using CPU.", file=sys.stderr)
        model = WhisperModel(ASR_MODEL, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(audio, language="ja", beam_size=5, vad_filter=False,
                                   condition_on_previous_text=False)
    return [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="TTS read-quality check (raw ASR vs script)")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--script_file", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    script = Path(args.script_file).read_text(encoding="utf-8")
    segments = transcribe(args.audio)
    report = compare_readings(script, segments, _kana_reading)
    report["asr_model"] = ASR_MODEL
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[voice_qa] reading {report['reading_match']:.1%}, onset {report['onset_match']:.1%}, "
          f"flagged {len(report['flagged'])} -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
