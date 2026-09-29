# -*- coding: utf-8 -*-
"""
Render Chapter 1 (Phần 1) of story_test_01 with multi-character voice cloning.
Zero emotion tags, optimal VieNeu v3 Turbo 48kHz parameters, dramatic pacing.
"""

import sys
import os
import re
import json
import time
import subprocess
import soundfile as sf
import numpy as np
import librosa
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
story_dir = REPO_ROOT / "web_vn" / "output" / "story_test_01"
ch1_out_dir = story_dir / "chapter_01_render"
ch1_out_dir.mkdir(parents=True, exist_ok=True)

VOICES_DIR = REPO_ROOT / "web_vn" / "voices"
DOWNLOADS = VOICES_DIR


# Load voice configurations from voices.json
voices_cfg = json.loads((REPO_ROOT / "web_vn" / "data" / "voice_profiles" / "voices.json").read_text(encoding="utf-8-sig"))

def clean_text_for_tts(text: str) -> str:
    text = re.sub(r"#+\s*", "", text)
    text = re.sub(r"\*{1,3}", "", text)
    text = re.sub(r"\[.*?\]", "", text)
    text = re.sub(r">>+\s*", "", text)
    text = re.sub(r"--+|==+", " ", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"\b\d{1,2}:\d{2}(:\d{2})?\b", "", text)
    for q in ['"', '“', '”', "'", '‘', '’']:
        text = text.replace(q, "")
    text = re.sub(r"\s+", " ", text).strip()
    return text

def parse_chapter_1():
    script_path = story_dir / "turn2_chapters_1_4.md"
    content = script_path.read_text(encoding="utf-8")

    # Extract Intro + Chapter 1
    ch1_raw = content[:16417]
    tokens = re.split(r'(\[SPEAKER(?::[a-zA-Z0-9_]+)?\])', ch1_raw)

    entries = []
    current_speaker = "bac_sam"

    for tok in tokens:
        tok_s = tok.strip()
        if not tok_s:
            continue

        sp_m = re.match(r'\[SPEAKER(?::([a-zA-Z0-9_]+))?\]', tok_s, re.I)
        if sp_m:
            raw = (sp_m.group(1) or "").lower()
            if raw:
                alias = {
                    "sam": "bac_sam", "bac_sam": "bac_sam", "narrator": "bac_sam",
                    "ha": "nhan_vat_chinh", "nu_chinh": "nhan_vat_chinh", "minh_ha": "nhan_vat_chinh",
                    "me": "me_chong", "me_chong": "me_chong", "ba_ly": "me_chong",
                    "vy": "tieu_tam", "tieu_tam": "tieu_tam", "thanh_vy": "tieu_tam",
                    "chong": "chong_boi_bac", "hung": "chong_boi_bac", "chong_boi_bac": "chong_boi_bac",
                }
                current_speaker = alias.get(raw, "bac_sam")
            continue

        clean = clean_text_for_tts(tok_s)
        if not clean or len(clean.split()) < 2:
            continue

        # Smart dialogue context detection
        if clean.startswith("Kính chào quý vị"):
            current_speaker = "bac_sam"
        elif clean.startswith("Cháu chào bác Sâm") or clean.startswith("Cháu tên là") or clean.startswith("Chiều hôm ấy, cháu tan làm"):
            current_speaker = "nhan_vat_chinh"
        elif "Ăn thêm đi con" in clean or "Người mang thai phải ăn" in clean or "Cô đừng làm căng nữa" in clean or "Dọn đi" in clean or "Nhà này là của con trai tôi" in clean:
            current_speaker = "me_chong"
        elif "Em nghe anh Hưng nhắc chị suốt" in clean or "Em biết nói gì lúc này" in clean or "Chị dọn xong chưa" in clean:
            current_speaker = "tieu_tam"
        elif "Vy đang có thai" in clean or "Ly hôn" in clean or "Em nên biết lúc nào" in clean or "Khoảng năm giờ" in clean or "Anh quên" in clean:
            current_speaker = "chong_boi_bac"

        # Split long paragraphs into sentence chunks (max 35 words for natural breathing)
        sents = re.split(r'(?<=[.!?…])\s+', clean)
        cur_chunk = []
        cur_w = 0
        for s in sents:
            s = s.strip()
            if not s:
                continue
            w_count = len(s.split())
            if cur_w + w_count <= 35:
                cur_chunk.append(s)
                cur_w += w_count
            else:
                if cur_chunk:
                    entries.append({"speaker": current_speaker, "text": " ".join(cur_chunk)})
                cur_chunk = [s]
                cur_w = w_count
        if cur_chunk:
            entries.append({"speaker": current_speaker, "text": " ".join(cur_chunk)})

    return entries

def trim_and_normalize(in_wav, out_wav, top_db=30, buffer_sec=0.12):
    y, sr = sf.read(in_wav)
    if y.ndim > 1:
        y = y.mean(axis=1)
    _, index = librosa.effects.trim(y, top_db=top_db)
    buf = int(buffer_sec * sr)
    s = max(0, index[0] - buf)
    e = min(len(y), index[1] + buf)
    temp = out_wav.parent / f"temp_{out_wav.name}"
    sf.write(temp, y[s:e], sr)
    subprocess.run([
        "ffmpeg", "-y", "-i", str(temp),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
        str(out_wav)
    ], check=True, capture_output=True)
    if temp.exists():
        temp.unlink()

def create_silence_wav(duration, out_path, sr=48000):
    sf.write(out_path, np.zeros(int(duration * sr), dtype=np.float32), sr)

def main():
    entries = parse_chapter_1()
    print(f"Parsed {len(entries)} chunks for Chapter 1:")
    
    # Speaker distribution
    spk_dist = {}
    for e in entries:
        spk_dist[e['speaker']] = spk_dist.get(e['speaker'], 0) + 1
    for spk, count in sorted(spk_dist.items()):
        print(f"  {spk:18s}: {count:3d} chunks")

    # Render on VieNeu-TTS v3 Turbo
    t0 = time.time()
    print("\n" + "="*60)
    print(">>> SYNTHESIZING CHAPTER 1 (VieNeu-TTS v3 Turbo 48kHz) <<<")
    print("="*60)

    from vieneu import Vieneu
    tts = Vieneu()

    chunks_dir = ch1_out_dir / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    norm_dir = ch1_out_dir / "norm"
    norm_dir.mkdir(parents=True, exist_ok=True)

    manifest_file = ch1_out_dir / "manifest.jsonl"
    with manifest_file.open("w", encoding="utf-8") as f:
        for idx, item in enumerate(entries, 1):
            c_id = f"ch1_{idx:04d}"
            item["id"] = c_id
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    for idx, item in enumerate(entries, 1):
        c_id = item["id"]
        spk = item["speaker"]
        text = item["text"]
        out_wav = chunks_dir / f"{c_id}.wav"
        norm_wav = norm_dir / f"{c_id}.wav"

        # Checkpoint: skip if exists
        if norm_wav.exists() and norm_wav.stat().st_size > 1000:
            print(f"  [{idx}/{len(entries)}] {c_id} ({spk}) -> Cached")
            continue

        pct = (idx / len(entries)) * 100
        print(f"  [{idx}/{len(entries)}] ({pct:.1f}%) {c_id} [{spk}] -> \"{text[:45]}...\"")

        cfg = voices_cfg.get(spk, voices_cfg["bac_sam"])
        ref_audio = cfg.get("ref_audio")
        style = cfg.get("style", "doc_truyen" if "sam" in spk or "chinh" in spk else "tu_nhien")
        temp = float(cfg.get("temperature", 0.82))
        top_p = float(cfg.get("top_p", 0.95))
        use_ref_codes = bool(cfg.get("use_ref_codes", True))

        if ref_audio and os.path.exists(ref_audio):
            audio = tts.infer(
                text,
                ref_audio=ref_audio,
                style=style,
                temperature=temp,
                top_p=top_p,
                top_k=25,
                use_ref_codes=use_ref_codes,
                denoise=True,
            )
        else:
            voice_name = cfg.get("voice", "Thanh Bình")
            audio = tts.infer(
                text,
                voice=voice_name,
                style=style,
                temperature=temp,
                top_p=top_p,
                top_k=25,
            )

        sf.write(out_wav, audio, tts.sample_rate)
        trim_and_normalize(out_wav, norm_wav)

    # Concat master audio with dramatic pacing
    print("\n=== CONCATENATING CHAPTER 1 MASTER AUDIO ===")
    sil_same = ch1_out_dir / "sil_same.wav"
    sil_turn = ch1_out_dir / "sil_turn.wav"
    sil_narr = ch1_out_dir / "sil_narr.wav"
    create_silence_wav(0.50, sil_same)
    create_silence_wav(0.90, sil_turn)
    create_silence_wav(1.35, sil_narr)

    concat_file = ch1_out_dir / "concat_list.txt"
    with concat_file.open("w", encoding="utf-8") as f:
        prev_speaker = None
        for item in entries:
            wav = norm_dir / f"{item['id']}.wav"
            if not wav.exists():
                continue
            curr = item["speaker"]
            if prev_speaker is not None:
                if prev_speaker == "bac_sam" or curr == "bac_sam":
                    f.write(f"file '{sil_narr.resolve()}'\n")
                elif prev_speaker != curr:
                    f.write(f"file '{sil_turn.resolve()}'\n")
                else:
                    f.write(f"file '{sil_same.resolve()}'\n")
            f.write(f"file '{wav.resolve()}'\n")
            prev_speaker = curr

    master_wav = ch1_out_dir / "chapter_01_master.wav"
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_file), "-c:a", "pcm_s16le", str(master_wav)
    ], check=True, capture_output=True)

    final_mp3 = story_dir / "chapter_01_full.mp3"
    subprocess.run([
        "ffmpeg", "-y", "-i", str(master_wav),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-b:a", "192k", str(final_mp3)
    ], check=True, capture_output=True)

    # Also copy to test_voices for web streaming
    web_stream_mp3 = REPO_ROOT / "web_vn" / "output" / "test_voices" / "chapter_01_full.mp3"
    web_stream_mp3.parent.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copy2(final_mp3, web_stream_mp3)

    data, sr = sf.read(final_mp3)
    dur = len(data) / sr

    print("\n" + "="*60)
    print(f" CHAPTER 1 RENDER COMPLETED IN {time.time() - t0:.1f}s!")
    print(f" Total Chunks: {len(entries)}")
    print(f" Audio Duration: {dur:.1f}s ({dur/60:.2f} mins)")
    print(f" Output File: {final_mp3.resolve()}")
    print(f" Web Stream: http://localhost:3005/api/audio?file=test_voices/chapter_01_full.mp3")
    print("="*60)

if __name__ == "__main__":
    main()