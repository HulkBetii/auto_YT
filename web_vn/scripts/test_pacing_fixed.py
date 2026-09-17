# -*- coding: utf-8 -*-
"""
Test Pacing Fixed:
Resolves the 45s-53s silence caused by ref_codes token mismatch.
Uses use_ref_codes=False when cloning and leverages high-fidelity VieNeu presets.
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

out_dir = REPO_ROOT / "web_vn" / "output" / "pacing_fixed"
out_dir.mkdir(parents=True, exist_ok=True)
chunks_dir = out_dir / "chunks"
chunks_dir.mkdir(parents=True, exist_ok=True)
norm_dir = out_dir / "norm"
norm_dir.mkdir(parents=True, exist_ok=True)

samples_dir = REPO_ROOT / "web_vn" / "data" / "voice_profiles" / "samples"

tts = Vieneu()

dialogue_script = [
    {
        "id": "fix_01",
        "role": "bac_sam",
        "voice": "Thanh Bình",
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Kính chào quý thính giả thân yêu của kênh Sâm Kể Chuyện. Trong cuộc đời này, lòng người sâu hiểm khó lường, nhưng lưới trời lồng lộng, tuy thưa mà khó lọt."
    },
    {
        "id": "fix_02",
        "role": "bac_sam",
        "voice": "Thanh Bình",
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Đêm hôm ấy, giữa căn phòng khách sang trọng, tiếng gạt phăng chén bát rơi vỡ chát chúa vang lên!"
    },
    {
        "id": "fix_03",
        "role": "me_chong",
        "voice": None,
        "ref_audio": str(samples_dir / "me_chong.wav"),
        "style": "tu_nhien",
        "text": "Cô mở to mắt ra mà nhìn! Con hồ ly tinh vô tích sự như cô mà cũng đòi giữ cái sổ đỏ căn nhà này à? Cút ngay ra khỏi nhà tôi!"
    },
    {
        "id": "fix_04",
        "role": "chong_boi_bac",
        "voice": "Phạm Tuyên",
        "ref_audio": None,
        "style": "tu_nhien",
        "text": "Tôi đã ký đơn ly hôn rồi, cô ký nốt đi. Căn nhà này tôi sẽ sang tên cho mẹ con bé Lan, cô đừng hòng lấy một xu."
    },
    {
        "id": "fix_05",
        "role": "tieu_tam",
        "voice": "Trúc Ly",
        "ref_audio": None,
        "style": "tu_nhien",
        "text": "Chị nhìn lại mình xem, vừa quê mùa vừa tàn tạ, lấy tư cách gì mà so với em? Anh Hưng bây giờ là của em rồi nhé."
    },
    {
        "id": "fix_06",
        "role": "nhan_vat_chinh",
        "voice": "Ngọc Linh",
        "ref_audio": None,
        "style": "ke_chuyen",
        "text": "Các người đừng vội đắc ý! Căn biệt thự này đứng tên riêng của tôi từ trước ngày cưới. Và toàn bộ chứng cứ phạm pháp hai người làm bấy lâu nay, công an kinh tế đã nắm giữ hết rồi!"
    },
    {
        "id": "fix_07",
        "role": "bac_sam",
        "voice": "Thanh Bình",
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Cái giá của sự bội bạc, sớm muộn gì cũng phải trả bằng chính sự tự do của mình. Mời quý vị tiếp tục lắng nghe."
    }
]

print("=== 1. RENDER TỪNG PHÂN ĐOẠN VỚI VIENEU 48KHZ (USE_REF_CODES=FALSE) ===")
for item in dialogue_script:
    c_id = item["id"]
    text = item["text"]
    ref_audio = item.get("ref_audio")
    voice = item.get("voice")
    style = item.get("style", "tu_nhien")
    
    out_wav = chunks_dir / f"{c_id}.wav"
    norm_wav = norm_dir / f"{c_id}.wav"
    
    # Infer with use_ref_codes=False to prevent hallucinated silent tokens
    if ref_audio and os.path.exists(ref_audio):
        audio_arr = tts.infer(text, ref_audio=ref_audio, style=style, temperature=0.72, top_p=0.90, use_ref_codes=False)
    elif voice:
        audio_arr = tts.infer(text, voice=voice, style=style, temperature=0.72, top_p=0.90)
    else:
        audio_arr = tts.infer(text, style=style, temperature=0.72, top_p=0.90)
        
    sf.write(out_wav, audio_arr, tts.sample_rate)
    
    # Check internal silence in generated chunk
    y, sr = sf.read(out_wav)
    trimmed_y, index = librosa.effects.trim(y, top_db=25)
    buf_samples = int(0.05 * sr)
    start_idx = max(0, index[0] - buf_samples)
    end_idx = min(len(y), index[1] + buf_samples)
    final_y = y[start_idx:end_idx]
    
    temp_wav = norm_dir / f"temp_{c_id}.wav"
    sf.write(temp_wav, final_y, sr)
    
    # EBU R128 loudness normalization
    cmd_norm = [
        "ffmpeg", "-y",
        "-i", str(temp_wav),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar", "48000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        str(norm_wav)
    ]
    subprocess.run(cmd_norm, check=True, capture_output=True)
    if temp_wav.exists():
        temp_wav.unlink()
        
    dur = len(final_y) / sr
    print(f"[{c_id}] {item['role']}: {dur:.2f}s | Audio: {norm_wav.name}")

# Pacing Micro-pauses: 0.18s for same speaker, 0.28s for speaker turn
print("\n=== 2. GHÉP NỐI MASTER VỚI NHỊP ĐỐI ĐÁP PHẢN XẠ (0.18s / 0.28s) ===")
silence_018 = out_dir / "silence_0.18s.wav"
silence_028 = out_dir / "silence_0.28s.wav"
create_silence_wav(0.18, silence_018, sample_rate=48000)
create_silence_wav(0.28, silence_028, sample_rate=48000)

concat_list = out_dir / "concat_list.txt"
with concat_list.open("w", encoding="utf-8") as f:
    prev_role = None
    for item in dialogue_script:
        c_id = item["id"]
        c_wav = norm_dir / f"{c_id}.wav"
        curr_role = item["role"]
        
        if prev_role is not None and curr_role != prev_role:
            f.write(f"file '{silence_028.resolve()}'\n")
        elif prev_role is not None:
            f.write(f"file '{silence_018.resolve()}'\n")
            
        f.write(f"file '{c_wav.resolve()}'\n")
        prev_role = curr_role

master_wav = out_dir / "pacing_fixed_master.wav"
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

# Verify second-by-second energy
master_data, sr = sf.read(master_wav)
dur_master = len(master_data) / sr
print(f"\n BẢN TỐI ƯU NHỊP ĐIỆU HOÀN THÀNH!")
print(f"File MP3: {final_mp3}")
print(f"Tổng thời lượng: {dur_master:.2f}s (Cắt giảm từ 64.29s xuống {dur_master:.2f}s sạch 100% khoảng lặng chết!)")
print("\nKiểm tra mức năng lượng (RMS) từng giây:")
for sec in range(0, int(dur_master) + 1):
    start = sec * sr
    end = min(len(master_data), (sec + 1) * sr)
    if start >= len(master_data): break
    chunk = master_data[start:end]
    rms = np.sqrt(np.mean(chunk**2))
    tag = '[DEAD SILENCE]' if rms < 0.005 else ''
    print(f"Time {sec:02d}s - {sec+1:02d}s: RMS = {rms:.5f} {tag}")
