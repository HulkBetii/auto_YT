# -*- coding: utf-8 -*-
"""
Long Dramatic Storytelling Scene Generator (~2.5 - 3 minutes)
Full multi-character confrontation demonstrating VieNeu-TTS v3 Turbo 48kHz,
rapid conversational exchanges, EBU R128 loudness normalization, and 0 dead air silence.
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

out_dir = REPO_ROOT / "web_vn" / "output" / "long_demo"
out_dir.mkdir(parents=True, exist_ok=True)
chunks_dir = out_dir / "chunks"
chunks_dir.mkdir(parents=True, exist_ok=True)
norm_dir = out_dir / "norm"
norm_dir.mkdir(parents=True, exist_ok=True)

samples_dir = REPO_ROOT / "web_vn" / "data" / "voice_profiles" / "samples"

print("=== 1. KHỞI TẠO VIENEU-TTS V3 TURBO (48KHZ) ===")
tts = Vieneu()

long_script = [
    {
        "id": "long_01",
        "role": "bac_sam",
        "voice": "Thanh Bình",
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Kính chào quý thính giả thân yêu của kênh Sâm Kể Chuyện. Người xưa thường bảo, sông sâu còn có kẻ dò, lòng người tuy cạn khó đo vơi đầy."
    },
    {
        "id": "long_02",
        "role": "bac_sam",
        "voice": "Thanh Bình",
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Có những kẻ sẵn sàng vì tiền tài danh vọng mà chà đạp lên ân tình nghĩa nặng suốt mười mấy năm trời."
    },
    {
        "id": "long_03",
        "role": "bac_sam",
        "voice": "Thanh Bình",
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Đêm hôm ấy, mâm cơm gia đình ngày giỗ bố chồng vừa dọn ra thì chiếc xe sang màu đen đỗ xịch trước cổng. Gã chồng rước ả nhân tình bụng mang dạ chửa đàng hoàng bước vào nhà, ném thẳng tập hồ sơ lên bàn trước mặt người vợ tào khang."
    },
    {
        "id": "long_04",
        "role": "chong_boi_bac",
        "voice": "Phạm Tuyên",
        "ref_audio": None,
        "style": "tu_nhien",
        "text": "Tôi không vòng vo nữa! Lan đã có thai con trai nối dõi cho dòng họ này rồi. Cô liệu mà ký vào đơn ly hôn và thu dọn đồ đạc rời khỏi đây trước ngày mai!"
    },
    {
        "id": "long_05",
        "role": "me_chong",
        "voice": None,
        "ref_audio": str(samples_dir / "me_chong.wav"),
        "style": "tu_nhien",
        "text": "Con trai tôi nói đúng đấy! Cái loại cau điếc như cô, bảy năm trời không đẻ nổi một mụn con thì lấy tư cách gì làm dâu nhà này? Cút đi cho khuất mắt tôi!"
    },
    {
        "id": "long_06",
        "role": "tieu_tam",
        "voice": "Trúc Ly",
        "ref_audio": None,
        "style": "tu_nhien",
        "text": "Chị Hà ơi, chị lớn tuổi rồi, nhan sắc cũng tàn tạ, giữ anh Hưng làm gì cho khổ cả hai? Anh ấy cần một người vợ trẻ đẹp, biết đẻ con trai và xứng tầm với căn biệt thự này cơ."
    },
    {
        "id": "long_07",
        "role": "bac_sam",
        "voice": "Thanh Bình",
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Từng lời nói cay độc như những nhát dao cứa thẳng vào tim người phụ nữ vừa đi làm về, bàn tay vẫn còn chai sạn vì gồng gánh trả nợ cho chồng lập nghiệp. Nhưng thay vì rơi nước mắt, ánh mắt cô bỗng lạnh băng."
    },
    {
        "id": "long_08",
        "role": "nhan_vat_chinh",
        "voice": "Ngọc Linh",
        "ref_audio": None,
        "style": "ke_chuyen",
        "text": "Các người nghĩ tôi là đứa ngu ngốc cam chịu suốt từng ấy năm sao? Bảy năm qua, tiền vốn cho anh mở công ty là của hồi môn bố mẹ tôi cho. Căn biệt thự này cũng đứng tên riêng của tôi từ trước ngày cưới!"
    },
    {
        "id": "long_09",
        "role": "me_chong",
        "voice": None,
        "ref_audio": str(samples_dir / "me_chong.wav"),
        "style": "tu_nhien",
        "text": "Cô... cô nói bậy! Nhà này là do con trai tôi làm ra! Cô đừng có ở đó mà đặt điều lừa gạt bà già này!"
    },
    {
        "id": "long_10",
        "role": "chong_boi_bac",
        "voice": "Phạm Tuyên",
        "ref_audio": None,
        "style": "tu_nhien",
        "text": "Cô đừng có to mồm! Tôi đã nhờ luật sư làm thủ tục sang tên rồi, cô không ký thì cũng phải ra đi tay trắng thôi!"
    },
    {
        "id": "long_11",
        "role": "nhan_vat_chinh",
        "voice": "Ngọc Linh",
        "ref_audio": None,
        "style": "ke_chuyen",
        "text": "Anh làm thủ tục giả mạo chữ ký của tôi đúng không? Tôi nói cho anh biết, chiếc điện thoại anh ném xuống sông để phi tang bằng chứng đã được công an trục vớt. Toàn bộ hồ sơ trốn thuế và rút ruột công ty của hai người đã nằm trên bàn của Đội Điều tra Kinh tế rồi!"
    },
    {
        "id": "long_12",
        "role": "tieu_tam",
        "voice": "Trúc Ly",
        "ref_audio": None,
        "style": "tu_nhien",
        "text": "Anh... anh Hưng ơi! Chị ta nói thật sao anh? Không phải anh bảo căn nhà này đứng tên anh hoàn toàn sao?"
    },
    {
        "id": "long_13",
        "role": "chong_boi_bac",
        "voice": "Phạm Tuyên",
        "ref_audio": None,
        "style": "tu_nhien",
        "text": "Hà... em bình tĩnh đã... chuyện vợ chồng đóng cửa bảo nhau, em làm thế là đẩy anh vào tù đấy!"
    },
    {
        "id": "long_14",
        "role": "nhan_vat_chinh",
        "voice": "Ngọc Linh",
        "ref_audio": None,
        "style": "ke_chuyen",
        "text": "Cơ hội cuối cùng tôi đã cho các người từ lâu rồi. Xe của cảnh sát điều tra đang đỗ ở cổng, các người ra mà giải trình với pháp luật!"
    },
    {
        "id": "long_15",
        "role": "bac_sam",
        "voice": "Thanh Bình",
        "ref_audio": str(samples_dir / "bac_sam.wav"),
        "style": "ke_chuyen",
        "text": "Tiếng còi xe công an rền vang xé tan màn đêm yên tĩnh. Mẹ chồng và gã đàn ông bội bạc chỉ biết chết lặng quỳ rạp dưới sàn nhà. Gieo nhân nào thì gặt quả nấy, lòng tham và sự vô ơn muôn đời đều phải trả giá đắt."
    }
]

print(f"\n=== 2. TIẾN HÀNH SINH {len(long_script)} PHÂN ĐOẠN THOẠI TRÊN GPU ===")
start_total = time.time()

for idx, item in enumerate(long_script, start=1):
    c_id = item["id"]
    text = item["text"]
    ref_audio = item.get("ref_audio")
    voice = item.get("voice")
    style = item.get("style", "tu_nhien")
    
    out_wav = chunks_dir / f"{c_id}.wav"
    norm_wav = norm_dir / f"{c_id}.wav"
    
    t0 = time.time()
    print(f"[{idx}/{len(long_script)}] Render {c_id} [{item['role']}]: \"{text[:40]}...\"")
    
    if ref_audio and os.path.exists(ref_audio):
        audio_arr = tts.infer(text, ref_audio=ref_audio, style=style, temperature=0.72, top_p=0.90, silence_p=0.03, crossfade_p=0.05, use_ref_codes=False)
    elif voice:
        audio_arr = tts.infer(text, voice=voice, style=style, temperature=0.72, top_p=0.90, silence_p=0.03, crossfade_p=0.05)
    else:
        audio_arr = tts.infer(text, style=style, temperature=0.72, top_p=0.90, silence_p=0.03, crossfade_p=0.05)
        
    sf.write(out_wav, audio_arr, tts.sample_rate)
    
    # Auto-trim dead silence with natural 0.05s buffer
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
        
    dt = time.time() - t0
    dur = len(final_y) / sr
    print(f"   -> Xong ({dt:.1f}s) | Độ dài active: {dur:.2f}s")

# Snappy micro-pauses
print("\n=== 3. GHÉP NỐI TOÀN BỘ VỚI NHỊP THỞ KỊCH TÍNH (0.18s / 0.28s / 0.8s) ===")
silence_018 = out_dir / "silence_0.18s.wav"
silence_028 = out_dir / "silence_0.28s.wav"
silence_080 = out_dir / "silence_0.80s.wav"
create_silence_wav(0.18, silence_018, sample_rate=48000)
create_silence_wav(0.28, silence_028, sample_rate=48000)
create_silence_wav(0.80, silence_080, sample_rate=48000)

concat_list = out_dir / "concat_list.txt"
with concat_list.open("w", encoding="utf-8") as f:
    prev_role = None
    for item in long_script:
        c_id = item["id"]
        c_wav = norm_dir / f"{c_id}.wav"
        curr_role = item["role"]
        
        if c_id == "long_15":
            f.write(f"file '{silence_080.resolve()}'\n")
        elif prev_role is not None and curr_role != prev_role:
            f.write(f"file '{silence_028.resolve()}'\n")
        elif prev_role is not None:
            f.write(f"file '{silence_018.resolve()}'\n")
            
        f.write(f"file '{c_wav.resolve()}'\n")
        prev_role = curr_role

master_wav = out_dir / "long_demo_master.wav"
cmd_concat = [
    "ffmpeg", "-y", "-f", "concat", "-safe", "0",
    "-i", str(concat_list),
    "-c:a", "pcm_s16le",
    str(master_wav)
]
subprocess.run(cmd_concat, check=True, capture_output=True)

final_mp3 = out_dir / "long_demo_scene_5_voices.mp3"
cmd_mp3 = [
    "ffmpeg", "-y",
    "-i", str(master_wav),
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-b:a", "192k",
    str(final_mp3)
]
subprocess.run(cmd_mp3, check=True, capture_output=True)

# Copy to test_voices for immediate web streaming
public_mp3 = REPO_ROOT / "web_vn" / "output" / "test_voices" / "long_demo_scene_5_voices.mp3"
import shutil
shutil.copy2(final_mp3, public_mp3)

# Waveform Energy Scan
master_data, sr = sf.read(master_wav)
dur_master = len(master_data) / sr
total_time = time.time() - start_total

print(f"\n BẢN DEMO DÀI ĐÃ HOÀN TẤT TRỌN VẸN!")
print(f"File MP3: {final_mp3} ({final_mp3.stat().st_size:,} bytes)")
print(f"Tổng thời lượng: {dur_master:.2f}s (~{dur_master/60:.2f} phút)")
print(f"Thời gian render toàn bộ 15 phân đoạn: {total_time:.1f}s")
