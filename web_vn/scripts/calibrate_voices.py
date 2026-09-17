# -*- coding: utf-8 -*-
"""
Audio Calibrator & Voice Refiner
Cuts clean 5-8s reference audio slices, normalizes loudness (EBU R128 -16 LUFS),
and configures optimal OmniVoice parameters for maximum human naturalness.
"""

import sys
import os
import subprocess
import json
import soundfile as sf
import numpy as np
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
PROFILES_DIR = REPO_ROOT / "web_vn" / "data" / "voice_profiles"
SAMPLES_DIR = PROFILES_DIR / "samples"
SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
RAW_DOWNLOADS = Path(r"C:\Users\HulkBeoti\Downloads")

# Define optimal slices for each character (5-8 seconds duration)
VOICE_SLICES = {
    "bac_sam": {
        "raw_file": RAW_DOWNLOADS / "bac-sam.mp3",
        "start": "0.0",
        "duration": "6.5",
        "ref_text": "Kính chào quý vị và các bạn đang lắng nghe Sâm kể chuyện. Đêm nay, bác Sâm xin mời quý vị cùng ngồi lại thật chậm.",
        "speed": 0.94,
        "guidance_scale": 2.2,
        "instruct": "Giọng nam trung niên trầm ấm, chiêm nghiệm, thong thả, rõ chữ"
    },
    "nhan_vat_chinh": {
        "raw_file": RAW_DOWNLOADS / "nu-chinh.WAV",
        "start": "24.0",
        "duration": "7.8",
        "ref_text": "Lúc nào mọi người cũng nghĩ rằng tôi sẽ quay lại với cả anh ta. Nhưng bản thân tôi biết, tôi sẽ không bao giờ làm như thế.",
        "speed": 0.96,
        "guidance_scale": 2.2,
        "instruct": "Giọng nữ Hà Nội truyền cảm, nghẹn ngào, tự trọng, kiên định"
    },
    "me_chong": {
        "raw_file": RAW_DOWNLOADS / "me-chong.WAV",
        "start": "35.0",
        "duration": "5.5",
        "ref_text": "Tôi nói để chị biết nhá, tôi không có thèm quỵt tiền của chị nhé, chị cầm lấy chị đi đi.",
        "speed": 1.00,
        "guidance_scale": 2.2,
        "instruct": "Giọng nữ lớn tuổi the thé, sắc lẹm, chì chiết, đanh thép"
    },
    "tieu_tam": {
        "raw_file": RAW_DOWNLOADS / "tieu-tam.WAV",
        "start": "0.0",
        "duration": "6.2",
        "ref_text": "Alo, em đây. Chị Dung giao cho em một số việc nên em đang tranh thủ đi làm ạ. Có chuyện gì không anh?",
        "speed": 0.98,
        "guidance_scale": 2.2,
        "instruct": "Giọng nữ trẻ lảnh lót, nũng nịu, ngọt ngào giả tạo, sắc sảo"
    },
    "chong_boi_bac": {
        "raw_file": RAW_DOWNLOADS / "nguoi-chong.WAV",
        "start": "1.5",
        "duration": "8.5",
        "ref_text": "Con đã bàn với mẹ rồi còn gì? Mẹ, con đã thuê được nhà rồi. Lát nữa xong việc, hai mẹ con mình dọn đồ nhá.",
        "speed": 0.98,
        "guidance_scale": 2.2,
        "instruct": "Giọng nam dứt khoát, lạnh lùng, gia trưởng, trịch thượng"
    }
}

print("=== 1. CHUẨN HÓA REFERENCE SAMPLES (-16 LUFS & 24KHZ MONO) ===")
voices_config = {}

for v_id, cfg in VOICE_SLICES.items():
    raw_src = cfg["raw_file"]
    out_sample = SAMPLES_DIR / f"{v_id}.wav"
    temp_cut = SAMPLES_DIR / f"temp_{v_id}.wav"
    
    # Cut slice and convert to 24kHz mono
    cmd_cut = [
        "ffmpeg", "-y",
        "-ss", cfg["start"],
        "-t", cfg["duration"],
        "-i", str(raw_src),
        "-ar", "24000",
        "-ac", "1",
        str(temp_cut)
    ]
    subprocess.run(cmd_cut, check=True, capture_output=True)
    
    # EBU R128 Loudness Normalization to -16 LUFS
    cmd_norm = [
        "ffmpeg", "-y",
        "-i", str(temp_cut),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar", "24000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        str(out_sample)
    ]
    subprocess.run(cmd_norm, check=True, capture_output=True)
    if temp_cut.exists():
        temp_cut.unlink()
        
    data, sr = sf.read(out_sample)
    rms = np.sqrt(np.mean(data**2))
    peak = np.max(np.abs(data))
    dur = len(data) / sr
    print(f"[{v_id}] Duration: {dur:.2f}s | RMS: {rms:.4f} | Peak: {peak:.4f} | Text: \"{cfg['ref_text']}\"")
    
    voices_config[v_id] = {
        "id": v_id,
        "name": v_id.replace("_", " ").title(),
        "ref_audio": str(out_sample),
        "ref_text": cfg["ref_text"],
        "speed": cfg["speed"],
        "guidance_scale": cfg["guidance_scale"],
        "instruct": cfg["instruct"]
    }

# Save updated voices.json
(PROFILES_DIR / "voices.json").write_text(
    json.dumps(voices_config, ensure_ascii=False, indent=2),
    encoding="utf-8"
)
print(f"\n Đã lưu cấu hình mới tại: {PROFILES_DIR / 'voices.json'}")
