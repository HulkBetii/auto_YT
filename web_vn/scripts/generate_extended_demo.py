# -*- coding: utf-8 -*-
"""
Generate Extended Clean Demo (No emotion tags, 100% natural dialogue).
All 5 voices cloned with VieNeu-TTS v3 Turbo 48kHz using user's audio samples.
"""

import sys
import os
import time
import subprocess
import soundfile as sf
import numpy as np
import librosa
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
out_dir = REPO_ROOT / "web_vn" / "output" / "extended_demo"
out_dir.mkdir(parents=True, exist_ok=True)

DOWNLOADS = Path(r"C:\Users\HulkBeoti\Downloads")

# Extended Dramatic Dialogue (~1.5 - 2 mins, no emotion tags)
SCRIPT = [
    {
        "id": "ext_01",
        "role": "bac_sam",
        "text": "Đêm hôm ấy, mâm cơm ngày giỗ vừa dọn ra thì chiếc xe sang màu đen đỗ xịch trước cổng. Gã chồng rước ả nhân tình bụng mang dạ chửa đàng hoàng bước vào nhà, trước sự ngỡ ngàng chết lặng của người vợ tám năm đồng cam cộng khổ.",
    },
    {
        "id": "ext_02",
        "role": "me_chong",
        "text": "Ăn thêm đi con! Người mang thai phải ăn cho hai người chứ ăn như mèo thế này thì cháu nội tôi lấy gì mà lớn? Đằng nào cô cũng về rồi thì nói luôn đi, giải quyết cho xong!",
    },
    {
        "id": "ext_03",
        "role": "tieu_tam",
        "text": "Chị Hà ơi... em biết nói gì lúc này cũng không đúng. Nhưng em đã có thai con trai của anh Hưng gần bốn tháng rồi... Chị lớn tuổi rồi, nhan sắc tàn tạ, buông tay để anh ấy lo cho mẹ con em đi chị.",
    },
    {
        "id": "ext_04",
        "role": "chong",
        "text": "Tôi không vòng vo nữa! Chúng ta lâu nay cũng chẳng còn tình cảm gì. Ly hôn đi! Căn nhà này và tài sản công ty là do tôi làm ra, cô dọn đồ rời khỏi đây ngay trong đêm nay!",
    },
    {
        "id": "ext_05",
        "role": "nu_chinh",
        "text": "Tám năm qua, từ những ngày anh đi đôi dép đứt quai phải buộc dây thép, đến số vàng hồi môn bố mẹ tôi trao ngày cưới để anh lập nghiệp... Giờ anh bảo tôi ra đi tay trắng sao?",
    },
    {
        "id": "ext_06",
        "role": "nu_chinh",
        "text": "Các người nghĩ tôi là đứa ngu ngốc cam chịu sao? Căn biệt thự mười hai tỷ này vốn đứng tên riêng của tôi! Anh quên rồi, nhưng giấy tờ và pháp luật thì không quên đâu!",
    },
    {
        "id": "ext_07",
        "role": "bac_sam",
        "text": "Có những kẻ tưởng mình vừa đuổi được người vợ tào khang ra đường trong mưa lạnh... nhưng họ không hề biết rằng, cái giá phải trả cho sự bội bạc giờ mới thực sự bắt đầu.",
    },
]

SILENCE_SAME_ROLE = 0.50
SILENCE_TURN_CHANGE = 0.90
SILENCE_NARRATOR = 1.35

def create_silence_wav(duration, out_path, sr=48000):
    sf.write(out_path, np.zeros(int(duration * sr), dtype=np.float32), sr)

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

def main():
    t0 = time.time()
    print("=" * 60)
    print(">>> GENERATING EXTENDED CLEAN DEMO (VieNeu v3 Turbo 48kHz) <<<")
    print("=" * 60)

    from vieneu import Vieneu
    tts = Vieneu()

    chunks_dir = out_dir / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    norm_dir = out_dir / "norm"
    norm_dir.mkdir(parents=True, exist_ok=True)

    voice_map = {
        "bac_sam":   {"ref_audio": str(DOWNLOADS / "bac-sam.mp3"),   "style": "doc_truyen", "temp": 0.82},
        "nu_chinh":  {"ref_audio": str(DOWNLOADS / "nu-chinh.WAV"),  "style": "doc_truyen", "temp": 0.82},
        "me_chong":  {"ref_audio": str(DOWNLOADS / "me-chong.WAV"),  "style": "tu_nhien",   "temp": 0.85},
        "tieu_tam":  {"ref_audio": str(DOWNLOADS / "tieu-tam.WAV"),  "style": "tu_nhien",   "temp": 0.83},
        "chong":     {"ref_audio": str(DOWNLOADS / "nguoi-chong.WAV"), "style": "tu_nhien", "temp": 0.80},
    }

    for idx, item in enumerate(SCRIPT, 1):
        cfg = voice_map[item["role"]]
        text = item["text"]
        out_wav = chunks_dir / f"{item['id']}.wav"
        norm_wav = norm_dir / f"{item['id']}.wav"
        print(f"  [{idx}/{len(SCRIPT)}] {item['id']} ({item['role']}) -> \"{text[:45]}...\"")

        audio = tts.infer(
            text,
            ref_audio=cfg["ref_audio"],
            style=cfg["style"],
            temperature=cfg["temp"],
            top_p=0.95,
            top_k=25,
            use_ref_codes=True,
            denoise=True,
        )
        sf.write(out_wav, audio, tts.sample_rate)
        trim_and_normalize(out_wav, norm_wav)

    # Concat with dramatic pacing
    sil_same = out_dir / "sil_same.wav"
    sil_turn = out_dir / "sil_turn.wav"
    sil_narr = out_dir / "sil_narr.wav"
    create_silence_wav(SILENCE_SAME_ROLE, sil_same)
    create_silence_wav(SILENCE_TURN_CHANGE, sil_turn)
    create_silence_wav(SILENCE_NARRATOR, sil_narr)

    concat_file = out_dir / "concat_list.txt"
    with concat_file.open("w", encoding="utf-8") as f:
        prev_role = None
        for item in SCRIPT:
            wav = norm_dir / f"{item['id']}.wav"
            if not wav.exists():
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

    master_wav = out_dir / "extended_demo_master.wav"
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_file), "-c:a", "pcm_s16le", str(master_wav)
    ], check=True, capture_output=True)

    final_mp3 = REPO_ROOT / "web_vn" / "output" / "extended_demo_clean.mp3"
    subprocess.run([
        "ffmpeg", "-y", "-i", str(master_wav),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-b:a", "192k", str(final_mp3)
    ], check=True, capture_output=True)

    data, sr = sf.read(final_mp3)
    dur = len(data) / sr

    print("\n" + "=" * 60)
    print(f" EXTENDED DEMO CREATED IN {time.time() - t0:.1f}s!")
    print(f" Duration: {dur:.1f}s ({dur/60:.1f} mins)")
    print(f" Path: {final_mp3.resolve()}")
    print("=" * 60)

if __name__ == "__main__":
    main()