# -*- coding: utf-8 -*-
"""
Generate 3 comparison demos (A/B/C) for voice naturalness benchmark.
- Demo A: Bac Sam clone + 4 characters VieNeu clone (ref_audio from user samples)
- Demo B: Bac Sam clone + 4 characters Edge-TTS Neural
- Demo C: Bac Sam clone + Hybrid (VieNeu preset for Nu Chinh + Edge-TTS for others)
"""

import sys
import os
import time
import asyncio
import soundfile as sf
import numpy as np
import librosa
import subprocess
import shutil
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
out_dir = REPO_ROOT / "web_vn" / "output" / "comparison_demos"
out_dir.mkdir(parents=True, exist_ok=True)

DOWNLOADS = Path(r"C:\Users\HulkBeoti\Downloads")

# Short dramatic script (~30s per demo)
SCRIPT = [
    {
        "id": "s01",
        "role": "bac_sam",
        "text": "[tho dai] Dem hom ay, mam com ngay gio vua don ra thi chiec xe sang mau den do xich truoc cong. Ga chong ruoc a nhan tinh bung mang da chua dang hoang buoc vao.",
        "text_vn": "[thở dài] Đêm hôm ấy, mâm cơm ngày giỗ vừa dọn ra thì chiếc xe sang màu đen đỗ xịch trước cổng. Gã chồng rước ả nhân tình bụng mang dạ chửa đàng hoàng bước vào.",
    },
    {
        "id": "s02",
        "role": "chong",
        "text_vn": "[hắng giọng] Tôi không vòng vo nữa! Lan đã có thai con trai nối dõi cho dòng họ này rồi! Cô mau ký vào đơn ly hôn!",
    },
    {
        "id": "s03",
        "role": "me_chong",
        "text_vn": "[cười] Con trai tôi nói đúng đấy! Cái loại cau điếc như cô, bảy năm trời không đẻ nổi một mụn con... thì lấy tư cách gì làm dâu nhà này?",
    },
    {
        "id": "s04",
        "role": "tieu_tam",
        "text_vn": "Chị Hà ơi... chị lớn tuổi rồi, nhan sắc tàn tạ, giữ anh Hưng làm gì cho khổ cả hai? [cười] Anh ấy cần một người vợ trẻ đẹp cơ!",
    },
    {
        "id": "s05",
        "role": "nu_chinh",
        "text_vn": "[thở dài] Các người nghĩ tôi là đứa ngu ngốc cam chịu sao? Bảy năm qua, vốn mở công ty là của hồi môn bố mẹ tôi cho! Căn biệt thự này cũng đứng tên riêng của tôi!",
    },
]

# Silence durations (dramatic pacing)
SILENCE_SAME_ROLE = 0.50
SILENCE_TURN_CHANGE = 0.90
SILENCE_NARRATOR = 1.30

def create_silence_wav(duration, out_path, sr=48000):
    sf.write(out_path, np.zeros(int(duration * sr), dtype=np.float32), sr)

def trim_and_normalize(in_wav, out_wav, top_db=30, buffer_sec=0.12):
    y, sr = sf.read(in_wav)
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

def concat_with_pacing(items, norm_dir, out_mp3, label):
    print(f"\n=== CONCATENATING {label} ===")
    sil_same = out_dir / "sil_same.wav"
    sil_turn = out_dir / "sil_turn.wav"
    sil_narr = out_dir / "sil_narr.wav"
    create_silence_wav(SILENCE_SAME_ROLE, sil_same)
    create_silence_wav(SILENCE_TURN_CHANGE, sil_turn)
    create_silence_wav(SILENCE_NARRATOR, sil_narr)

    concat_file = out_dir / f"concat_{label}.txt"
    with concat_file.open("w", encoding="utf-8") as f:
        prev_role = None
        for item in items:
            wav = norm_dir / f"{item['id']}.wav"
            if not wav.exists():
                print(f"  WARN: Missing {wav}")
                continue
            curr = item["role"]
            if prev_role is not None:
                if prev_role == "bac_sam" or curr == "bac_sam":
                    f.write(f"file '{sil_narr.resolve()}'\n")
                elif prev_role != curr:
                    f.write(f"file '{sil_turn.resolve()}'\n")
                else:
                    f.write(f"file '{sil_same.resolve()}'\n")
            f.write(f"file '{wav.resolve()}'\n")
            prev_role = curr

    master = out_dir / f"master_{label}.wav"
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_file), "-c:a", "pcm_s16le", str(master)
    ], check=True, capture_output=True)
    subprocess.run([
        "ffmpeg", "-y", "-i", str(master),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-b:a", "192k", str(out_mp3)
    ], check=True, capture_output=True)
    data, sr = sf.read(out_mp3)
    print(f"  -> {out_mp3.name} ({len(data)/sr:.1f}s)")

# ===================== DEMO A: VieNeu Clone All =====================
def build_demo_a():
    print("\n" + "="*60)
    print(">>> DEMO A: Bac Sam clone + 4 VieNeu Clone <<<")
    print("="*60)
    from vieneu import Vieneu
    tts = Vieneu()

    chunks_dir = out_dir / "chunks_a"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    norm_dir = out_dir / "norm_a"
    norm_dir.mkdir(parents=True, exist_ok=True)

    voice_map = {
        "bac_sam":   {"ref_audio": str(DOWNLOADS / "bac-sam.mp3"),   "style": "doc_truyen", "temp": 0.82, "use_ref_codes": True},
        "nu_chinh":  {"ref_audio": str(DOWNLOADS / "nu-chinh.WAV"),  "style": "doc_truyen", "temp": 0.82, "use_ref_codes": True},
        "me_chong":  {"ref_audio": str(DOWNLOADS / "me-chong.WAV"),  "style": "tu_nhien",   "temp": 0.85, "use_ref_codes": True},
        "tieu_tam":  {"ref_audio": str(DOWNLOADS / "tieu-tam.WAV"),  "style": "tu_nhien",   "temp": 0.83, "use_ref_codes": True},
        "chong":     {"ref_audio": str(DOWNLOADS / "nguoi-chong.WAV"), "style": "tu_nhien", "temp": 0.80, "use_ref_codes": True},
    }

    for idx, item in enumerate(SCRIPT, 1):
        cfg = voice_map[item["role"]]
        text = item.get("text_vn", item.get("text"))
        out_wav = chunks_dir / f"{item['id']}.wav"
        norm_wav = norm_dir / f"{item['id']}.wav"
        print(f"  [{idx}/{len(SCRIPT)}] A: {item['id']} ({item['role']}) -> \"{text[:40]}...\"")

        audio = tts.infer(
            text,
            ref_audio=cfg["ref_audio"],
            style=cfg["style"],
            temperature=cfg["temp"],
            top_p=0.95,
            top_k=25,
            use_ref_codes=cfg["use_ref_codes"],
            denoise=True,
        )
        sf.write(out_wav, audio, tts.sample_rate)
        trim_and_normalize(out_wav, norm_wav)

    mp3 = out_dir / "demo_a_vieneu_clone_all.mp3"
    concat_with_pacing(SCRIPT, norm_dir, mp3, "demo_a")
    return mp3

# ===================== DEMO B: Edge-TTS All Characters =====================
async def build_demo_b_async(tts):
    print("\n" + "="*60)
    print(">>> DEMO B: Bac Sam clone + 4 Edge-TTS Neural <<<")
    print("="*60)
    import edge_tts
    import re

    chunks_dir = out_dir / "chunks_b"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    norm_dir = out_dir / "norm_b"
    norm_dir.mkdir(parents=True, exist_ok=True)

    edge_map = {
        "nu_chinh":  {"voice": "vi-VN-HoaiMyNeural", "rate": "-3%",  "pitch": "+0Hz"},
        "me_chong":  {"voice": "vi-VN-HoaiMyNeural", "rate": "+8%",  "pitch": "-15Hz"},
        "tieu_tam":  {"voice": "vi-VN-HoaiMyNeural", "rate": "+3%",  "pitch": "+25Hz"},
        "chong":     {"voice": "vi-VN-NamMinhNeural", "rate": "+5%",  "pitch": "+10Hz"},
    }

    for idx, item in enumerate(SCRIPT, 1):
        text = item.get("text_vn", item.get("text"))
        out_wav = chunks_dir / f"{item['id']}.wav"
        norm_wav = norm_dir / f"{item['id']}.wav"
        print(f"  [{idx}/{len(SCRIPT)}] B: {item['id']} ({item['role']}) -> \"{text[:40]}...\"")

        if item["role"] == "bac_sam":
            # Clone Bac Sam with VieNeu (same as Demo A)
            audio = tts.infer(
                text,
                ref_audio=str(DOWNLOADS / "bac-sam.mp3"),
                style="doc_truyen",
                temperature=0.82,
                top_p=0.95,
                top_k=25,
                use_ref_codes=True,
                denoise=True,
            )
            sf.write(out_wav, audio, tts.sample_rate)
        else:
            # Edge-TTS for characters
            cfg = edge_map[item["role"]]
            clean_text = re.sub(r"\[.*?\]", "", text).strip()
            temp_mp3 = chunks_dir / f"{item['id']}.mp3"
            comm = edge_tts.Communicate(clean_text, cfg["voice"], rate=cfg["rate"], pitch=cfg["pitch"])
            await comm.save(str(temp_mp3))
            subprocess.run([
                "ffmpeg", "-y", "-i", str(temp_mp3),
                "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", str(out_wav)
            ], check=True, capture_output=True)
            if temp_mp3.exists():
                temp_mp3.unlink()

        trim_and_normalize(out_wav, norm_wav)

    mp3 = out_dir / "demo_b_edge_tts_chars.mp3"
    concat_with_pacing(SCRIPT, norm_dir, mp3, "demo_b")
    return mp3

# ===================== DEMO C: Hybrid =====================
async def build_demo_c_async(tts):
    print("\n" + "="*60)
    print(">>> DEMO C: Bac Sam clone + Hybrid (VieNeu Nu Chinh + Edge-TTS others) <<<")
    print("="*60)
    import edge_tts
    import re

    chunks_dir = out_dir / "chunks_c"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    norm_dir = out_dir / "norm_c"
    norm_dir.mkdir(parents=True, exist_ok=True)

    edge_map = {
        "me_chong":  {"voice": "vi-VN-HoaiMyNeural", "rate": "+8%",  "pitch": "-15Hz"},
        "tieu_tam":  {"voice": "vi-VN-HoaiMyNeural", "rate": "+3%",  "pitch": "+25Hz"},
        "chong":     {"voice": "vi-VN-NamMinhNeural", "rate": "+5%",  "pitch": "+10Hz"},
    }

    for idx, item in enumerate(SCRIPT, 1):
        text = item.get("text_vn", item.get("text"))
        out_wav = chunks_dir / f"{item['id']}.wav"
        norm_wav = norm_dir / f"{item['id']}.wav"
        print(f"  [{idx}/{len(SCRIPT)}] C: {item['id']} ({item['role']}) -> \"{text[:40]}...\"")

        if item["role"] == "bac_sam":
            audio = tts.infer(
                text,
                ref_audio=str(DOWNLOADS / "bac-sam.mp3"),
                style="doc_truyen",
                temperature=0.82,
                top_p=0.95, top_k=25,
                use_ref_codes=True, denoise=True,
            )
            sf.write(out_wav, audio, tts.sample_rate)
        elif item["role"] == "nu_chinh":
            # VieNeu clone for Nu Chinh
            audio = tts.infer(
                text,
                ref_audio=str(DOWNLOADS / "nu-chinh.WAV"),
                style="doc_truyen",
                temperature=0.82,
                top_p=0.95, top_k=25,
                use_ref_codes=True, denoise=True,
            )
            sf.write(out_wav, audio, tts.sample_rate)
        else:
            # Edge-TTS for Me Chong, Tieu Tam, Chong
            cfg = edge_map[item["role"]]
            clean_text = re.sub(r"\[.*?\]", "", text).strip()
            temp_mp3 = chunks_dir / f"{item['id']}.mp3"
            comm = edge_tts.Communicate(clean_text, cfg["voice"], rate=cfg["rate"], pitch=cfg["pitch"])
            await comm.save(str(temp_mp3))
            subprocess.run([
                "ffmpeg", "-y", "-i", str(temp_mp3),
                "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", str(out_wav)
            ], check=True, capture_output=True)
            if temp_mp3.exists():
                temp_mp3.unlink()

        trim_and_normalize(out_wav, norm_wav)

    mp3 = out_dir / "demo_c_hybrid.mp3"
    concat_with_pacing(SCRIPT, norm_dir, mp3, "demo_c")
    return mp3


if __name__ == "__main__":
    t0 = time.time()

    # Init VieNeu once, reuse for all demos
    from vieneu import Vieneu
    tts = Vieneu()

    # Demo A: All VieNeu clone
    mp3_a = build_demo_a()

    # Demo B: Edge-TTS chars
    mp3_b = asyncio.run(build_demo_b_async(tts))

    # Demo C: Hybrid
    mp3_c = asyncio.run(build_demo_c_async(tts))

    # Copy to test_voices for web streaming
    pub = REPO_ROOT / "web_vn" / "output" / "test_voices"
    pub.mkdir(parents=True, exist_ok=True)
    for mp3 in [mp3_a, mp3_b, mp3_c]:
        shutil.copy2(mp3, pub / mp3.name)

    print(f"\n{'='*60}")
    print(f" ALL 3 DEMOS CREATED IN {time.time()-t0:.1f}s!")
    print(f" A (VieNeu Clone All): {mp3_a}")
    print(f" B (Edge-TTS Chars):   {mp3_b}")
    print(f" C (Hybrid):           {mp3_c}")
    print(f"{'='*60}")