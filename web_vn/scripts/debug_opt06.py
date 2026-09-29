# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding="utf-8")
from vieneu import Vieneu
from pathlib import Path
import soundfile as sf
import numpy as np
import librosa

tts = Vieneu()
text = "Các người đừng vội đắc ý! Căn biệt thự này đứng tên riêng của tôi từ trước ngày cưới. Và toàn bộ chứng cứ phạm pháp hai người làm bấy lâu nay, công an kinh tế đã nắm giữ hết rồi!"

from vieneu.v3turbo import normalize_to_chunks_v3_with_gaps
chunks, gaps = normalize_to_chunks_v3_with_gaps(text, max_chars=256)
print("Chunks:", chunks)
print("Gaps:", gaps)

full_arr = tts.infer(text, voice="Ngọc Linh", style="ke_chuyen", temperature=0.72, top_p=0.90)
full_dur = len(full_arr) / 48000
print(f"Full infer total duration: {full_dur:.2f}s")
non_silent_full = librosa.effects.split(full_arr, top_db=25)
print("Full infer speech intervals:")
for start, end in non_silent_full:
    print(f"   speech: {start/48000:.2f}s -> {end/48000:.2f}s (dur = {(end-start)/48000:.2f}s)")
