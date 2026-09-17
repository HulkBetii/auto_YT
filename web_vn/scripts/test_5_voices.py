# -*- coding: utf-8 -*-
import os
import sys
import subprocess
import json
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

repo_root = Path(r"D:\VibeCoding\auto_YT")
out_dir = repo_root / "web_vn" / "output" / "test_voices"
out_dir.mkdir(parents=True, exist_ok=True)

profiles_file = repo_root / "web_vn" / "data" / "voice_profiles" / "voices.json"
voices = json.loads(profiles_file.read_text(encoding="utf-8"))

test_lines = {
    "bac_sam": "Kính chào quý vị và các bạn đang lắng nghe Sâm kể chuyện. Đêm nay, bác Sâm xin mời quý vị cùng ngồi lại thật chậm.",
    "nhan_vat_chinh": "Tám năm qua cháu hy sinh cho gia đình này không phải để hôm nay bị người ta đuổi ra đường trong đêm mưa.",
    "me_chong": "Cô đừng có ở đó mà kể công! Nhà này là của con trai tôi, cô đừng hòng lấy đi một đồng tài sản nào!",
    "tieu_tam": "Anh Hưng à, bác sĩ bảo con trai trong bụng dạo này đạp nhiều lắm, anh phải lo cho tương lai của mẹ con em chứ.",
    "chong_boi_bac": "Cô ký đơn ly hôn đi, đừng có làm ầm ĩ lên cho xấu mặt cả hai bên."
}

for v_id, text in test_lines.items():
    v = voices.get(v_id)
    if not v:
        print(f"Profile {v_id} not found!")
        continue
    
    out_wav = out_dir / f"test_{v_id}.wav"
    print(f"--- Generating Voice: {v_id} ---")
    print(f"Text: {text}")
    
    cmd = [
        "omnivoice-infer",
        "--text", text,
        "--output", str(out_wav),
        "--ref_audio", v["ref_audio"],
        "--ref_text", v["ref_text"],
        "--language", "vi",
        "--speed", str(v.get("speed", 0.95)),
        "--guidance_scale", str(v.get("guidance_scale", 2.5))
    ]
    
    res = subprocess.run(cmd, capture_output=True, text=True)
    if out_wav.exists() and out_wav.stat().st_size > 1000:
        print(f"SUCCESS: Generated {out_wav.name} ({out_wav.stat().st_size:,} bytes)")
    else:
        print(f"FAILED for {v_id}: {res.stderr}")

print("\n=== ALL 5 VOICES TEST COMPLETED! ===")
