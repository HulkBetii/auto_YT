# -*- coding: utf-8 -*-
"""
Test Pacing Optimization: Auto-trim dead silence, tighten micro-pauses (0.2s/0.3s),
and calibrate VieNeu internal silence_p for snappy, natural human conversational rhythm.
"""

import sys
import os
import time
import soundfile as sf
import numpy as np
import librosa
import subprocess
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
SRC_SCRIPTS = REPO_ROOT / "web_vn" / "scripts"
if str(SRC_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SRC_SCRIPTS))

from vieneu import Vieneu
from audio_mixer import create_silence_wav

out_dir = REPO_ROOT / "web_vn" / "output" / "pacing_test"
out_dir.mkdir(parents=True, exist_ok=True)
chunks_dir = out_dir / "chunks"
chunks_dir.mkdir(parents=True, exist_ok=True)
trimmed_dir = out_dir / "trimmed"
trimmed_dir.mkdir(parents=True, exist_ok=True)

samples_dir = REPO_ROOT / "web_vn" / "data" / "voice_profiles" / "samples"

tts = Vieneu()

dialogue_script = [
    {
        "id": "opt_01",
        "role": "bac_sam",
        "voice": "Thanh Bình",
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Kính chào quý thính giả thân yêu của kênh Sâm Kể Chuyện. Trong cuộc đời này, lòng người sâu hiểm khó lường, nhưng lưới trời lồng lộng, tuy thưa mà khó lọt."
    },
    {
        "id": "opt_02",
        "role": "bac_sam",
        "voice": "Thanh Bình",
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Đêm hôm ấy, giữa căn phòng khách sang trọng, tiếng gạt phăng chén bát rơi vỡ chát chúa vang lên!"
    },
    {
        "id": "opt_03",
        "role": "me_chong",
        "voice": None,
        "ref_audio": str(samples_dir / "me_chong.wav"),
        "style": "tu_nhien",
        "text": "Cô mở to mắt ra mà nhìn! Con hồ ly tinh vô tích sự như cô mà cũng đòi giữ cái sổ đỏ căn nhà này à? Cút ngay ra khỏi nhà tôi!"
    },
    {
        "id": "opt_04",
        "role": "chong_boi_bac",
        "voice": "Phạm Tuyên",
        "ref_audio": str(samples_dir / "chong_boi_bac.wav"),
        "style": "tu_nhien",
        "text": "Tôi đã ký đơn ly hôn rồi, cô ký nốt đi. Căn nhà này tôi sẽ sang tên cho mẹ con bé Lan, cô đừng hòng lấy một xu."
    },
    {
        "id": "opt_05",
        "role": "tieu_tam",
        "voice": "Trúc Ly",
        "ref_audio": str(samples_dir / "tieu_tam.wav"),
        "style": "tu_nhien",
        "text": "Chị nhìn lại mình xem, vừa quê mùa vừa tàn tạ, lấy tư cách gì mà so với em? Anh Hưng bây giờ là của em rồi nhé."
    },
    {
        "id": "opt_06",
        "role": "nhan_vat_chinh",
        "voice": "Ngọc Linh",
        "ref_audio": str(samples_dir / "nhan_vat_chinh.wav"),
        "style": "ke_chuyen",
        "text": "Các người đừng vội đắc ý! Căn biệt thự này đứng tên riêng của tôi từ trước ngày cưới. Và toàn bộ chứng cứ phạm pháp hai người làm bấy lâu nay, công an kinh tế đã nắm giữ hết rồi!"
    },
    {
        "id": "opt_07",
        "role": "bac_sam",
        "voice": "Thanh Bình",
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Cái giá của sự bội bạc, sớm muộn gì cũng phải trả bằng chính sự tự do của mình. Mời quý vị tiếp tục lắng nghe."
    }
]

print("=== 1. RENDER VỚI SILENCE_P=0.03 & TỰ ĐỘNG CẮT DEAD AIR SILENCE ===")
for item in dialogue_script:
    c_id = item["id"]
    text = item["text"]
    ref_audio = item["ref_audio"]
    voice = item.get("voice")
    style = item.get("style", "tu_nhien")
    
    out_wav = chunks_dir / f"{c_id}.wav"
    trimmed_wav = trimmed_dir / f"{c_id}.wav"
    
    # Infer with tightly tuned silence_p
    if ref_audio and os.path.exists(ref_audio):
        audio_arr = tts.infer(text, ref_audio=ref_audio, style=style, temperature=0.72, top_p=0.90, silence_p=0.03, crossfade_p=0.05)
    elif voice:
        audio_arr = tts.infer(text, voice=voice, style=style, temperature=0.72, top_p=0.90, silence_p=0.03, crossfade_p=0.05)
    else:
        audio_arr = tts.infer(text, style=style, temperature=0.72, top_p=0.90, silence_p=0.03, crossfade_p=0.05)
        
    sf.write(out_wav, audio_arr, tts.sample_rate)
    
    # Auto-trim dead silence with 0.05s natural head/tail buffer
    y, sr = sf.read(out_wav)
    trimmed_y, index = librosa.effects.trim(y, top_db=25)
    
    # Add a tiny 0.05s buffer to avoid clipping plosives
    buf_samples = int(0.05 * sr)
    start_idx = max(0, index[0] - buf_samples)
    end_idx = min(len(y), index[1] + buf_samples)
    final_y = y[start_idx:end_idx]
    
    temp_wav = trimmed_dir / f"temp_{c_id}.wav"
    sf.write(temp_wav, final_y, sr)
    
    # Normalize loudness to EBU R128 (-16 LUFS)
    cmd_norm = [
        "ffmpeg", "-y",
        "-i", str(temp_wav),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar", "48000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        str(trimmed_wav)
    ]
    subprocess.run(cmd_norm, check=True, capture_output=True)
    if temp_wav.exists():
        temp_wav.unlink()
        
    dur = len(final_y) / sr
    print(f"[{c_id}] {item['role']}: {dur:.2f}s | Audio: {trimmed_wav.name}")

# Pacing Micro-pauses: 0.18s for same speaker, 0.28s for speaker turn
print("\n=== 2. GHÉP NỐI VỚI NHỊP THOẠI KỊCH TÍNH (0.18s / 0.28s) ===")
silence_018 = out_dir / "silence_0.18s.wav"
silence_028 = out_dir / "silence_0.28s.wav"
create_silence_wav(0.18, silence_018, sample_rate=48000)
create_silence_wav(0.28, silence_028, sample_rate=48000)

concat_list = out_dir / "concat_list.txt"
with concat_list.open("w", encoding="utf-8") as f:
    prev_role = None
    for item in dialogue_script:
        c_id = item["id"]
        c_wav = trimmed_dir / f"{c_id}.wav"
        curr_role = item["role"]
        
        if prev_role is not None and curr_role != prev_role:
            f.write(f"file '{silence_028.resolve()}'\n")
        elif prev_role is not None:
            f.write(f"file '{silence_018.resolve()}'\n")
            
        f.write(f"file '{c_wav.resolve()}'\n")
        prev_role = curr_role

master_wav = out_dir / "optimized_scene_master.wav"
cmd_concat = [
    "ffmpeg", "-y", "-f", "concat", "-safe", "0",
    "-i", str(concat_list),
    "-c:a", "pcm_s16le",
    str(master_wav)
]
subprocess.run(cmd_concat, check=True, capture_output=True)

final_mp3 = out_dir / "optimized_pacing_5_voices.mp3"
cmd_mp3 = [
    "ffmpeg", "-y",
    "-i", str(master_wav),
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-b:a", "192k",
    str(final_mp3)
]
subprocess.run(cmd_mp3, check=True, capture_output=True)

# Copy to test_voices for web serving
public_mp3 = REPO_ROOT / "web_vn" / "output" / "test_voices" / "optimized_pacing_5_voices.mp3"
import shutil
shutil.copy2(final_mp3, public_mp3)

dur_master = len(sf.read(master_wav)[0]) / 48000
print(f"\n BẢN TỐI ƯU NHỊP ĐIỆU HOÀN THÀNH!")
print(f"File MP3: {final_mp3}")
print(f"Tổng thời lượng: {dur_master:.2f}s (gọn gàng, đối đáp tự nhiên, không còn khoảng lặng chết)")
