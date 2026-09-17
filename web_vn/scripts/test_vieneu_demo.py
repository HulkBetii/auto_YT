# -*- coding: utf-8 -*-
"""
VieNeu-TTS v3 Turbo (48kHz) Emotional Storytelling Test
Compares native Vietnamese prosody & voice cloning with 48kHz audio quality.
"""

import sys
import os
import time
import json
import soundfile as sf
import numpy as np
import subprocess
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
SRC_SCRIPTS = REPO_ROOT / "web_vn" / "scripts"
if str(SRC_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SRC_SCRIPTS))

from vieneu import Vieneu
from audio_mixer import create_silence_wav

out_dir = REPO_ROOT / "web_vn" / "output" / "vieneu_demo"
out_dir.mkdir(parents=True, exist_ok=True)
chunks_dir = out_dir / "chunks"
chunks_dir.mkdir(parents=True, exist_ok=True)

samples_dir = REPO_ROOT / "web_vn" / "data" / "voice_profiles" / "samples"

# Initialize VieNeu model
print("=== Khởi tạo VieNeu-TTS v3 Turbo (48kHz) ===")
tts = Vieneu()

dialogue_script = [
    {
        "id": "vn_01",
        "role": "bac_sam",
        "voice": "Thanh Bình", # Native Northern Storyteller preset
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Kính chào quý thính giả thân yêu của kênh Sâm Kể Chuyện. Trong cuộc đời này, lòng người sâu hiểm khó lường, nhưng lưới trời lồng lộng, tuy thưa mà khó lọt."
    },
    {
        "id": "vn_02",
        "role": "bac_sam",
        "voice": "Thanh Bình",
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Đêm hôm ấy, giữa căn phòng khách sang trọng, tiếng gạt phăng chén bát rơi vỡ chát chúa vang lên!"
    },
    {
        "id": "vn_03",
        "role": "me_chong",
        "voice": None,
        "ref_audio": str(samples_dir / "me_chong.wav"),
        "style": "tu_nhien",
        "text": "Cô mở to mắt ra mà nhìn! Con hồ ly tinh vô tích sự như cô mà cũng đòi giữ cái sổ đỏ căn nhà này à? Cút ngay ra khỏi nhà tôi!"
    },
    {
        "id": "vn_04",
        "role": "chong_boi_bac",
        "voice": "Phạm Tuyên",
        "ref_audio": str(samples_dir / "chong_boi_bac.wav"),
        "style": "tu_nhien",
        "text": "Tôi đã ký đơn ly hôn rồi, cô ký nốt đi. Căn nhà này tôi sẽ sang tên cho mẹ con bé Lan, cô đừng hòng lấy một xu."
    },
    {
        "id": "vn_05",
        "role": "tieu_tam",
        "voice": "Trúc Ly",
        "ref_audio": str(samples_dir / "tieu_tam.wav"),
        "style": "tu_nhien",
        "text": "Chị nhìn lại mình xem, vừa quê mùa vừa tàn tạ, lấy tư cách gì mà so với em? Anh Hưng bây giờ là của em rồi nhé."
    },
    {
        "id": "vn_06",
        "role": "nhan_vat_chinh",
        "voice": "Ngọc Linh",
        "ref_audio": str(samples_dir / "nhan_vat_chinh.wav"),
        "style": "ke_chuyen",
        "text": "Các người đừng vội đắc ý! Căn biệt thự này đứng tên riêng của tôi từ trước ngày cưới. Và toàn bộ chứng cứ phạm pháp hai người làm bấy lâu nay, công an kinh tế đã nắm giữ hết rồi!"
    },
    {
        "id": "vn_07",
        "role": "bac_sam",
        "voice": "Thanh Bình",
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Cái giá của sự bội bạc, sớm muộn gì cũng phải trả bằng chính sự tự do của mình. Mời quý vị tiếp tục lắng nghe."
    }
]

print("\n=== 1. TẠO TỪNG CHUNK VỚI VIENEU-TTS (48KHZ) ===")
start_total = time.time()

for item in dialogue_script:
    c_id = item["id"]
    text = item["text"]
    ref_audio = item["ref_audio"]
    voice = item.get("voice")
    style = item.get("style", "tu_nhien")
    
    out_wav = chunks_dir / f"{c_id}.wav"
    t0 = time.time()
    print(f"\n[VieNeu] Render {c_id} ({item['role']}): \"{text}\"")
    
    # Infer with VieNeu
    if ref_audio and os.path.exists(ref_audio):
        audio_arr = tts.infer(text, ref_audio=ref_audio, temperature=0.75, top_p=0.92)
    elif voice:
        audio_arr = tts.infer(text, voice=voice, style=style, temperature=0.75, top_p=0.92)
    else:
        audio_arr = tts.infer(text, style=style, temperature=0.75, top_p=0.92)
        
    dt = time.time() - t0
    sf.write(out_wav, audio_arr, tts.sample_rate)
    
    # Normalize with loudnorm
    norm_wav = chunks_dir / f"norm_{c_id}.wav"
    cmd_norm = [
        "ffmpeg", "-y",
        "-i", str(out_wav),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-c:a", "pcm_s16le",
        str(norm_wav)
    ]
    subprocess.run(cmd_norm, check=True, capture_output=True)
    print(f"-> Hoàn tất ({dt:.2f}s) | 48kHz audio: {norm_wav.name}")

# Concatenate with micro-pauses
print("\n=== 2. GHÉP NỐI MASTER VỚI NHỊP THỞ TỰ NHIÊN ===")
silence_035 = out_dir / "silence_0.35s.wav"
silence_065 = out_dir / "silence_0.65s.wav"
create_silence_wav(0.35, silence_035, sample_rate=48000)
create_silence_wav(0.65, silence_065, sample_rate=48000)

concat_list = out_dir / "concat_list.txt"
with concat_list.open("w", encoding="utf-8") as f:
    prev_role = None
    for item in dialogue_script:
        c_id = item["id"]
        c_wav = chunks_dir / f"norm_{c_id}.wav"
        curr_role = item["role"]
        
        if prev_role is not None and curr_role != prev_role:
            f.write(f"file '{silence_065.resolve()}'\n")
        elif prev_role is not None:
            f.write(f"file '{silence_035.resolve()}'\n")
            
        f.write(f"file '{c_wav.resolve()}'\n")
        prev_role = curr_role

master_wav = out_dir / "vieneu_scene_master.wav"
cmd_concat = [
    "ffmpeg", "-y", "-f", "concat", "-safe", "0",
    "-i", str(concat_list),
    "-c:a", "pcm_s16le",
    str(master_wav)
]
subprocess.run(cmd_concat, check=True, capture_output=True)

final_mp3 = out_dir / "vieneu_demo_scene_5_voices.mp3"
cmd_mp3 = [
    "ffmpeg", "-y",
    "-i", str(master_wav),
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-b:a", "192k",
    str(final_mp3)
]
subprocess.run(cmd_mp3, check=True, capture_output=True)

# Copy to test_voices for web serving
public_mp3 = REPO_ROOT / "web_vn" / "output" / "test_voices" / "vieneu_demo_scene_5_voices.mp3"
import shutil
shutil.copy2(final_mp3, public_mp3)

total_time = time.time() - start_total
print(f"\n VIENEU DEMO HOÀN THÀNH!")
print(f"File MP3: {final_mp3} ({final_mp3.stat().st_size:,} bytes)")
print(f"Thời gian render: {total_time:.1f}s")
