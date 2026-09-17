# -*- coding: utf-8 -*-
"""
Generate a high-quality, loudness-normalized 5-voice dramatic scene demo.
Ensures zero glitch, equalized volume (EBU R128), and natural human speech prosody.
"""

import os
import sys
import json
import time
import subprocess
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
SRC_SCRIPTS = REPO_ROOT / "web_vn" / "scripts"
if str(SRC_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SRC_SCRIPTS))

from audio_mixer import create_silence_wav

out_dir = REPO_ROOT / "web_vn" / "output" / "demo_scene"
out_dir.mkdir(parents=True, exist_ok=True)
raw_chunks_dir = out_dir / "raw_chunks"
raw_chunks_dir.mkdir(parents=True, exist_ok=True)
norm_chunks_dir = out_dir / "norm_chunks"
norm_chunks_dir.mkdir(parents=True, exist_ok=True)

profiles_file = REPO_ROOT / "web_vn" / "data" / "voice_profiles" / "voices.json"
voices = json.loads(profiles_file.read_text(encoding="utf-8"))

dialogue_script = [
    {
        "id": "demo_01",
        "speaker": "bac_sam",
        "text": "Kính chào quý thính giả thân yêu của kênh Sâm Kể Chuyện. Trong cuộc đời này, lòng người sâu hiểm khó lường, nhưng lưới trời lồng lộng, tuy thưa mà khó lọt."
    },
    {
        "id": "demo_02",
        "speaker": "bac_sam",
        "text": "Đêm hôm ấy, giữa căn phòng khách sang trọng, tiếng gạt phăng chén bát rơi vỡ chát chúa vang lên."
    },
    {
        "id": "demo_03",
        "speaker": "me_chong",
        "text": "Cô mở to mắt ra mà nhìn! Con hồ ly tinh vô tích sự như cô mà cũng đòi giữ cái sổ đỏ căn nhà này à? Cút ngay ra khỏi nhà tôi!"
    },
    {
        "id": "demo_04",
        "speaker": "chong_boi_bac",
        "text": "Tôi đã ký đơn ly hôn rồi, cô ký nốt đi. Căn nhà này tôi sẽ sang tên cho mẹ con bé Lan, cô đừng hòng lấy một xu."
    },
    {
        "id": "demo_05",
        "speaker": "tieu_tam",
        "text": "Chị nhìn lại mình xem, vừa quê mùa vừa tàn tạ, lấy tư cách gì mà so với em? Anh Hưng bây giờ là của em rồi nhé."
    },
    {
        "id": "demo_06",
        "speaker": "nhan_vat_chinh",
        "text": "Các người đừng vội đắc ý! Căn biệt thự này đứng tên riêng của tôi từ trước ngày cưới. Và toàn bộ chứng cứ phạm pháp hai người làm bấy lâu nay, công an kinh tế đã nắm giữ hết rồi!"
    },
    {
        "id": "demo_07",
        "speaker": "bac_sam",
        "text": "Cái giá của sự bội bạc, sớm muộn gì cũng phải trả bằng chính sự tự do của mình. Mời quý vị tiếp tục lắng nghe."
    }
]

print("=== 1. TẠO TỪNG PHÂN ĐOẠN THOẠI OMNIVOICE (NUM_STEP=50, GUIDANCE=2.2) ===")
start_total = time.time()

for item in dialogue_script:
    c_id = item["id"]
    spk = item["speaker"]
    text = item["text"]
    v = voices.get(spk)
    
    raw_wav = raw_chunks_dir / f"{c_id}.wav"
    norm_wav = norm_chunks_dir / f"{c_id}.wav"
    
    print(f"\n[OmniVoice] Render {c_id} [{spk}]:")
    print(f"Thoại: \"{text}\"")
    
    cmd = [
        "omnivoice-infer",
        "--text", text,
        "--output", str(raw_wav),
        "--ref_audio", v["ref_audio"],
        "--ref_text", v["ref_text"],
        "--language", "vi",
        "--speed", str(v.get("speed", 0.96)),
        "--guidance_scale", str(v.get("guidance_scale", 2.2)),
        "--num_step", "50"
    ]
    
    t0 = time.time()
    res = subprocess.run(cmd, capture_output=True, text=True)
    dt = time.time() - t0
    
    if not (raw_wav.exists() and raw_wav.stat().st_size > 1000):
        print(f"-> Lỗi render chunk {c_id}: {res.stderr}")
        continue
    
    # Apply loudness normalization (EBU R128 -16 LUFS) to each chunk
    cmd_norm = [
        "ffmpeg", "-y",
        "-i", str(raw_wav),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar", "24000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        str(norm_wav)
    ]
    subprocess.run(cmd_norm, check=True, capture_output=True)
    print(f"-> Hoàn tất & Chuẩn hóa âm lượng ({dt:.1f}s) | Size: {norm_wav.stat().st_size:,} bytes")

print("\n=== 2. GHÉP NỐI TOÀN BỘ PHÂN ĐOẠN VỚI MICRO-PAUSE TỰ NHIÊN ===")
silence_035 = out_dir / "silence_0.35s.wav"
silence_065 = out_dir / "silence_0.65s.wav"
create_silence_wav(0.35, silence_035)
create_silence_wav(0.65, silence_065)

concat_list = out_dir / "concat_list.txt"
with concat_list.open("w", encoding="utf-8") as f:
    prev_speaker = None
    for item in dialogue_script:
        c_id = item["id"]
        c_wav = norm_chunks_dir / f"{c_id}.wav"
        curr_speaker = item["speaker"]
        
        if prev_speaker is not None and curr_speaker != prev_speaker:
            f.write(f"file '{silence_065.resolve()}'\n")
        elif prev_speaker is not None:
            f.write(f"file '{silence_035.resolve()}'\n")
            
        f.write(f"file '{c_wav.resolve()}'\n")
        prev_speaker = curr_speaker

master_wav = out_dir / "demo_scene_master.wav"
cmd_concat = [
    "ffmpeg", "-y", "-f", "concat", "-safe", "0",
    "-i", str(concat_list),
    "-c:a", "pcm_s16le",
    str(master_wav)
]
subprocess.run(cmd_concat, check=True, capture_output=True)

# Master EBU R128 normalization and 192k MP3 export
final_mp3 = out_dir / "demo_scene_5_voices.mp3"
cmd_mp3 = [
    "ffmpeg", "-y",
    "-i", str(master_wav),
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-b:a", "192k",
    str(final_mp3)
]
subprocess.run(cmd_mp3, check=True, capture_output=True)

# Also update test_voices for immediate web streaming
public_mp3 = REPO_ROOT / "web_vn" / "output" / "test_voices" / "demo_scene_5_voices.mp3"
import shutil
shutil.copy2(final_mp3, public_mp3)

total_time = time.time() - start_total
print(f"\n HOÀN THÀNH TẠO AUDIO DEMO CHẤT LƯỢNG CAO!")
print(f"File Audio MP3: {final_mp3} ({final_mp3.stat().st_size:,} bytes)")
print(f"Thời gian render: {total_time:.1f}s")
