# -*- coding: utf-8 -*-
"""
Test voice naturalness and dramatic pacing:
1. VieNeu-TTS v3 Turbo 48kHz with Emotion tags ([thở dài], [cười], [hắng giọng]),
   calibrated presets (Thanh Bình, Ngọc Linh, Mai Anh, Trúc Ly, Phạm Tuyên),
   expressive punctuation, and natural dramatic pauses (0.85s between speaker turns).
2. Edge-TTS Multi-character Neural with pitch/rate character modulation.
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
out_dir = REPO_ROOT / "web_vn" / "output" / "naturalness_test"
out_dir.mkdir(parents=True, exist_ok=True)
chunks_dir = out_dir / "chunks_vieneu"
chunks_dir.mkdir(parents=True, exist_ok=True)

test_script = [
    {
        "id": "scene_01",
        "role": "bac_sam",
        "voice_vieneu": "Thanh Bình",
        "style_vieneu": "ke_chuyen",
        "temp_vieneu": 0.85,
        "text": "Kính chào quý thính giả thân yêu của kênh Sâm Kể Chuyện. [thở dài] Người xưa thường bảo: Sông sâu còn có kẻ dò, lòng người tuy cạn... khó đo vơi đầy.",
        "edge_voice": "vi-VN-NamMinhNeural",
        "edge_rate": "-5%",
        "edge_pitch": "-3Hz"
    },
    {
        "id": "scene_02",
        "role": "bac_sam",
        "voice_vieneu": "Thanh Bình",
        "style_vieneu": "ke_chuyen",
        "temp_vieneu": 0.85,
        "text": "Đêm hôm ấy, mâm cơm ngày giỗ vừa dọn ra thì chiếc xe sang màu đen đỗ xịch trước cổng. Gã chồng rước ả nhân tình bụng mang dạ chửa đàng hoàng bước vào, ném thẳng tờ đơn ly hôn lên bàn.",
        "edge_voice": "vi-VN-NamMinhNeural",
        "edge_rate": "-2%",
        "edge_pitch": "-2Hz"
    },
    {
        "id": "scene_03",
        "role": "chong",
        "voice_vieneu": "Phạm Tuyên",
        "style_vieneu": "tu_nhien",
        "temp_vieneu": 0.92,
        "text": "[hắng giọng] Tôi không vòng vo nữa! Lan đã có thai con trai nối dõi cho dòng họ này rồi! Cô mau ký vào đơn ly hôn, thu dọn đồ đạc rời khỏi đây ngay!",
        "edge_voice": "vi-VN-NamMinhNeural",
        "edge_rate": "+8%",
        "edge_pitch": "+15Hz"
    },
    {
        "id": "scene_04",
        "role": "me_chong",
        "voice_vieneu": "Mai Anh",
        "style_vieneu": "tu_nhien",
        "temp_vieneu": 0.92,
        "text": "[cười] Con trai tôi nói đúng đấy! Cái loại cau điếc như cô, bảy năm trời không đẻ nổi một mụn con... thì lấy tư cách gì làm dâu nhà này? Cút đi cho khuất mắt tôi!",
        "edge_voice": "vi-VN-HoaiMyNeural",
        "edge_rate": "+5%",
        "edge_pitch": "-10Hz"
    },
    {
        "id": "scene_05",
        "role": "tieu_tam",
        "voice_vieneu": "Trúc Ly",
        "style_vieneu": "tu_nhien",
        "temp_vieneu": 0.90,
        "text": "Chị Hà ơi... chị lớn tuổi rồi, nhan sắc tàn tạ, giữ anh Hưng làm gì cho khổ cả hai? [cười] Anh ấy cần một người vợ trẻ đẹp, biết sinh con trai cơ!",
        "edge_voice": "vi-VN-HoaiMyNeural",
        "edge_rate": "+2%",
        "edge_pitch": "+20Hz"
    },
    {
        "id": "scene_06",
        "role": "nu_chinh",
        "voice_vieneu": "Ngọc Linh",
        "style_vieneu": "ke_chuyen",
        "temp_vieneu": 0.90,
        "text": "[thở dài] Các người nghĩ tôi là đứa ngu ngốc cam chịu sao? Bảy năm qua, vốn mở công ty là của hồi môn bố mẹ tôi cho! Căn biệt thự này cũng đứng tên riêng của tôi từ trước ngày cưới!",
        "edge_voice": "vi-VN-HoaiMyNeural",
        "edge_rate": "-2%",
        "edge_pitch": "+0Hz"
    },
    {
        "id": "scene_07",
        "role": "nu_chinh",
        "voice_vieneu": "Ngọc Linh",
        "style_vieneu": "ke_chuyen",
        "temp_vieneu": 0.90,
        "text": "Chiếc điện thoại anh ném xuống sông phi tang đã được công an trục vớt. Toàn bộ hồ sơ trốn thuế và rút ruột công ty của hai người... đã nằm trên bàn Đội Điều tra Kinh tế rồi!",
        "edge_voice": "vi-VN-HoaiMyNeural",
        "edge_rate": "+0%",
        "edge_pitch": "+2Hz"
    },
    {
        "id": "scene_08",
        "role": "chong",
        "voice_vieneu": "Phạm Tuyên",
        "style_vieneu": "tu_nhien",
        "temp_vieneu": 0.92,
        "text": "Hà... em bình tĩnh đã... [thở dài] Chuyện vợ chồng đóng cửa bảo nhau, em làm thế là đẩy anh vào tù đấy!",
        "edge_voice": "vi-VN-NamMinhNeural",
        "edge_rate": "-3%",
        "edge_pitch": "-5Hz"
    },
    {
        "id": "scene_09",
        "role": "nu_chinh",
        "voice_vieneu": "Ngọc Linh",
        "style_vieneu": "ke_chuyen",
        "temp_vieneu": 0.90,
        "text": "Cơ hội cuối cùng tôi đã cho các người từ lâu rồi. Xe của cảnh sát điều tra đang đỗ ở cổng, các người ra mà giải trình với pháp luật!",
        "edge_voice": "vi-VN-HoaiMyNeural",
        "edge_rate": "+2%",
        "edge_pitch": "+0Hz"
    },
    {
        "id": "scene_10",
        "role": "bac_sam",
        "voice_vieneu": "Thanh Bình",
        "style_vieneu": "ke_chuyen",
        "temp_vieneu": 0.85,
        "text": "[thở dài] Tiếng còi xe công an rền vang xé tan màn đêm tĩnh mịch. Kẻ phản bội và người mẹ cay độc chỉ biết chết lặng. Gieo nhân nào thì gặt quả nấy, lòng tham và sự vô ơn muôn đời đều phải trả giá đắt.",
        "edge_voice": "vi-VN-NamMinhNeural",
        "edge_rate": "-5%",
        "edge_pitch": "-3Hz"
    }
]

def create_silence_wav(duration: float, out_path: Path, sample_rate: int = 48000):
    num_samples = int(duration * sample_rate)
    silence = np.zeros(num_samples, dtype=np.float32)
    sf.write(out_path, silence, sample_rate)

def build_vieneu_version():
    print("\n=======================================================")
    print(">>> 1. GENERATING VIENEU V3 TURBO (CINEMATIC EMOTION) <<<")
    print("=======================================================")
    from vieneu import Vieneu
    tts = Vieneu()
    
    norm_dir = out_dir / "norm_vieneu"
    norm_dir.mkdir(parents=True, exist_ok=True)
    
    for idx, item in enumerate(test_script, 1):
        c_id = item["id"]
        text = item["text"]
        voice = item["voice_vieneu"]
        style = item["style_vieneu"]
        temp = item["temp_vieneu"]
        
        out_wav = chunks_dir / f"{c_id}.wav"
        norm_wav = norm_dir / f"{c_id}.wav"
        
        print(f"[{idx}/{len(test_script)}] VieNeu: {c_id} ({item['role']} - {voice}) -> \"{text[:35]}...\"")
        
        audio_arr = tts.infer(
            text,
            voice=voice,
            style=style,
            temperature=temp,
            top_p=0.95,
            top_k=30,
            silence_p=0.08,
            crossfade_p=0.05
        )
        sf.write(out_wav, audio_arr, tts.sample_rate)
        
        y, sr = sf.read(out_wav)
        trimmed_y, index = librosa.effects.trim(y, top_db=30)
        buf_samples = int(0.10 * sr)
        start_idx = max(0, index[0] - buf_samples)
        end_idx = min(len(y), index[1] + buf_samples)
        final_y = y[start_idx:end_idx]
        
        temp_wav = norm_dir / f"temp_{c_id}.wav"
        sf.write(temp_wav, final_y, sr)
        
        cmd_norm = [
            "ffmpeg", "-y", "-i", str(temp_wav),
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
            str(norm_wav)
        ]
        subprocess.run(cmd_norm, check=True, capture_output=True)
        if temp_wav.exists():
            temp_wav.unlink()

    silence_045 = out_dir / "silence_0.45s.wav"
    silence_085 = out_dir / "silence_0.85s.wav"
    silence_125 = out_dir / "silence_1.25s.wav"
    create_silence_wav(0.45, silence_045, 48000)
    create_silence_wav(0.85, silence_085, 48000)
    create_silence_wav(1.25, silence_125, 48000)
    
    concat_list = out_dir / "concat_vieneu.txt"
    with concat_list.open("w", encoding="utf-8") as f:
        prev_role = None
        for item in test_script:
            c_id = item["id"]
            c_wav = norm_dir / f"{c_id}.wav"
            curr_role = item["role"]
            
            if prev_role is not None:
                if prev_role == "bac_sam" or curr_role == "bac_sam":
                    f.write(f"file '{silence_125.resolve()}'\n")
                elif prev_role != curr_role:
                    f.write(f"file '{silence_085.resolve()}'\n")
                else:
                    f.write(f"file '{silence_045.resolve()}'\n")
                    
            f.write(f"file '{c_wav.resolve()}'\n")
            prev_role = curr_role
            
    master_wav = out_dir / "vieneu_cinematic_master.wav"
    cmd_concat = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_list),
        "-c:a", "pcm_s16le",
        str(master_wav)
    ]
    subprocess.run(cmd_concat, check=True, capture_output=True)
    
    final_mp3 = out_dir / "vieneu_cinematic_pacing_demo.mp3"
    cmd_mp3 = [
        "ffmpeg", "-y", "-i", str(master_wav),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-b:a", "192k",
        str(final_mp3)
    ]
    subprocess.run(cmd_mp3, check=True, capture_output=True)
    print(f"VieNeu Output MP3: {final_mp3}")
    return final_mp3

async def build_edge_tts_version():
    print("\n=======================================================")
    print(">>> 2. GENERATING EDGE-TTS NEURAL (MICROSOFT VTV/VOV) <<<")
    print("=======================================================")
    import edge_tts
    import re
    
    chunks_edge = out_dir / "chunks_edge"
    chunks_edge.mkdir(parents=True, exist_ok=True)
    norm_edge = out_dir / "norm_edge"
    norm_edge.mkdir(parents=True, exist_ok=True)
    
    for idx, item in enumerate(test_script, 1):
        c_id = item["id"]
        raw_text = re.sub(r"\[.*?\]", "", item["text"]).strip()
        voice = item["edge_voice"]
        rate = item["edge_rate"]
        pitch = item["edge_pitch"]
        
        out_mp3 = chunks_edge / f"{c_id}.mp3"
        norm_wav = norm_edge / f"{c_id}.wav"
        
        print(f"[{idx}/{len(test_script)}] Edge-TTS: {c_id} ({item['role']} - {voice}) -> \"{raw_text[:35]}...\"")
        
        communicate = edge_tts.Communicate(raw_text, voice, rate=rate, pitch=pitch)
        await communicate.save(str(out_mp3))
        
        cmd_norm = [
            "ffmpeg", "-y", "-i", str(out_mp3),
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
            str(norm_wav)
        ]
        subprocess.run(cmd_norm, check=True, capture_output=True)

    silence_045 = out_dir / "silence_0.45s.wav"
    silence_085 = out_dir / "silence_0.85s.wav"
    silence_125 = out_dir / "silence_1.25s.wav"
    
    concat_list = out_dir / "concat_edge.txt"
    with concat_list.open("w", encoding="utf-8") as f:
        prev_role = None
        for item in test_script:
            c_id = item["id"]
            c_wav = norm_edge / f"{c_id}.wav"
            curr_role = item["role"]
            
            if prev_role is not None:
                if prev_role == "bac_sam" or curr_role == "bac_sam":
                    f.write(f"file '{silence_125.resolve()}'\n")
                elif prev_role != curr_role:
                    f.write(f"file '{silence_085.resolve()}'\n")
                else:
                    f.write(f"file '{silence_045.resolve()}'\n")
                    
            f.write(f"file '{c_wav.resolve()}'\n")
            prev_role = curr_role
            
    master_wav = out_dir / "edge_master.wav"
    cmd_concat = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_list),
        "-c:a", "pcm_s16le",
        str(master_wav)
    ]
    subprocess.run(cmd_concat, check=True, capture_output=True)
    
    final_mp3 = out_dir / "edge_tts_natural_demo.mp3"
    cmd_mp3 = [
        "ffmpeg", "-y", "-i", str(master_wav),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-b:a", "192k",
        str(final_mp3)
    ]
    subprocess.run(cmd_mp3, check=True, capture_output=True)
    print(f"Edge-TTS Output MP3: {final_mp3}")
    return final_mp3

if __name__ == "__main__":
    t_start = time.time()
    
    v_mp3 = build_vieneu_version()
    e_mp3 = asyncio.run(build_edge_tts_version())
    
    public_dir = REPO_ROOT / "web_vn" / "output" / "test_voices"
    public_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(v_mp3, public_dir / "vieneu_cinematic_pacing_demo.mp3")
    shutil.copy2(e_mp3, public_dir / "edge_tts_natural_demo.mp3")
    
    print("\n=======================================================")
    print(f" ALL BENCHMARK AUDIO CREATED IN {time.time() - t_start:.1f}s!")
    print(f"1. VieNeu Cinematic: {v_mp3}")
    print(f"2. Edge-TTS Natural: {e_mp3}")
    print("=======================================================")