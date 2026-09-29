# -*- coding: utf-8 -*-
"""
Demo D: Bac Sam VieNeu clone + 4 characters OmniVoice clone from user audio samples.
OmniVoice uses iterative masked diffusion (24kHz) with voice cloning via ref_audio.
"""

import sys
import os
import time
import subprocess
import shutil
import re
import numpy as np
import soundfile as sf
import librosa
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
out_dir = REPO_ROOT / "web_vn" / "output" / "comparison_demos"
out_dir.mkdir(parents=True, exist_ok=True)

DOWNLOADS = Path(r"C:\Users\HulkBeoti\Downloads")

SCRIPT = [
    {
        "id": "s01",
        "role": "bac_sam",
        "text_vn": "[thở dài] Đêm hôm ấy, mâm cơm ngày giỗ vừa dọn ra thì chiếc xe sang màu đen đỗ xịch trước cổng. Gã chồng rước ả nhân tình bụng mang dạ chửa đàng hoàng bước vào.",
    },
    {
        "id": "s02",
        "role": "chong",
        "text_vn": "Tôi không vòng vo nữa! Lan đã có thai con trai nối dõi cho dòng họ này rồi! Cô mau ký vào đơn ly hôn!",
    },
    {
        "id": "s03",
        "role": "me_chong",
        "text_vn": "Con trai tôi nói đúng đấy! Cái loại cau điếc như cô, bảy năm trời không đẻ nổi một mụn con... thì lấy tư cách gì làm dâu nhà này?",
    },
    {
        "id": "s04",
        "role": "tieu_tam",
        "text_vn": "Chị Hà ơi... chị lớn tuổi rồi, nhan sắc tàn tạ, giữ anh Hưng làm gì cho khổ cả hai? Anh ấy cần một người vợ trẻ đẹp cơ!",
    },
    {
        "id": "s05",
        "role": "nu_chinh",
        "text_vn": "Các người nghĩ tôi là đứa ngu ngốc cam chịu sao? Bảy năm qua, vốn mở công ty là của hồi môn bố mẹ tôi cho! Căn biệt thự này cũng đứng tên riêng của tôi!",
    },
]

SILENCE_SAME_ROLE = 0.50
SILENCE_TURN_CHANGE = 0.90
SILENCE_NARRATOR = 1.30


def create_silence_wav(duration, out_path, sr=48000):
    sf.write(out_path, np.zeros(int(duration * sr), dtype=np.float32), sr)


def trim_and_normalize(in_wav, out_wav, top_db=30, buffer_sec=0.12, target_sr=48000):
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
        "-ar", str(target_sr), "-ac", "1", "-c:a", "pcm_s16le",
        str(out_wav)
    ], check=True, capture_output=True)
    if temp.exists():
        temp.unlink()


def concat_with_pacing(items, norm_dir, out_mp3, label):
    print(f"\n=== CONCATENATING {label} ===")
    sil_same = out_dir / "sil_same.wav"
    sil_turn = out_dir / "sil_turn.wav"
    sil_narr = out_dir / "sil_narr.wav"
    create_silence_wav(SILENCE_SAME_ROLE, sil_same)
    create_silence_wav(SILENCE_TURN_CHANGE, sil_turn)
    create_silence_wav(SILENCE_NARRATOR, sil_narr)

    concat_file = out_dir / f"concat_{label}.txt"
    with concat_file.open("w", encoding="utf-8") as f:
        prev_role = None
        for item in items:
            wav = norm_dir / f"{item['id']}.wav"
            if not wav.exists():
                print(f"  WARN: Missing {wav}")
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

    master = out_dir / f"master_{label}.wav"
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_file), "-c:a", "pcm_s16le", str(master)
    ], check=True, capture_output=True)
    subprocess.run([
        "ffmpeg", "-y", "-i", str(master),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-b:a", "192k", str(out_mp3)
    ], check=True, capture_output=True)
    data, sr = sf.read(out_mp3)
    print(f"  -> {out_mp3.name} ({len(data)/sr:.1f}s)")


def build_demo_d():
    print("\n" + "="*60)
    print(">>> DEMO D: Bac Sam VieNeu clone + 4 OmniVoice Clone <<<")
    print("="*60)

    # Init VieNeu for Bac Sam
    from vieneu import Vieneu
    vieneu = Vieneu()

    # Init OmniVoice for characters
    from omnivoice import OmniVoice, OmniVoiceGenerationConfig
    omni = OmniVoice.from_pretrained("k2-fsa/OmniVoice")

    chunks_dir = out_dir / "chunks_d"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    norm_dir = out_dir / "norm_d"
    norm_dir.mkdir(parents=True, exist_ok=True)

    # Pre-computed ref_text via faster-whisper, trimmed to 8s (OmniVoice optimal: 3-10s)
    TRIMMED = REPO_ROOT / "web_vn" / "output" / "comparison_demos" / "ref_trimmed"
    ref_map = {
        "chong":    (TRIMMED / "nguoi-chong_8s.wav", "Mẹ, con đã bàn với mẹ rồi còn gì mẹ."),
        "me_chong": (TRIMMED / "me-chong_8s.wav",    "Chị nói thế là có ý gì? Chị nói cứ như thế, tôi có ý định quyết tiền của chị không bằng."),
        "tieu_tam": (TRIMMED / "tieu-tam_8s.wav",    "Alo, em đây. Chị Dung ra cho em một số việc nên em đang tranh thủ đi làm ạ. Có chuyện gì không anh? Thôi chết."),
        "nu_chinh": (TRIMMED / "nu-chinh_8s.wav",    "Sao hôm trước anh không nói với tôi anh đánh anh Thái vì tiểu về số."),
    }


    gen_config = OmniVoiceGenerationConfig(
        num_step=32,
        guidance_scale=2.0,
        denoise=True,
        postprocess_output=True,
    )

    # Speed mapping per character
    speed_map = {
        "chong":    1.0,
        "me_chong": 1.1,   # Faster, aggressive
        "tieu_tam": 1.05,  # Slightly fast, sly
        "nu_chinh": 0.92,  # Slower, emotional
    }

    for idx, item in enumerate(SCRIPT, 1):
        text = item["text_vn"]
        out_wav = chunks_dir / f"{item['id']}.wav"
        norm_wav = norm_dir / f"{item['id']}.wav"
        print(f"\n  [{idx}/{len(SCRIPT)}] D: {item['id']} ({item['role']}) -> \"{text[:40]}...\"")

        if item["role"] == "bac_sam":
            # VieNeu clone for Bac Sam
            audio = vieneu.infer(
                text,
                ref_audio=str(DOWNLOADS / "bac-sam.mp3"),
                style="doc_truyen",
                temperature=0.82,
                top_p=0.95,
                top_k=25,
                use_ref_codes=True,
                denoise=True,
            )
            sf.write(out_wav, audio, vieneu.sample_rate)
        else:
            # OmniVoice clone for characters
            clean_text = re.sub(r"\[.*?\]", "", text).strip()
            spd = speed_map.get(item["role"], 1.0)
            ref_path, ref_text = ref_map[item["role"]]
            results = omni.generate(
                text=clean_text,
                language="vietnamese",
                ref_audio=str(ref_path),
                ref_text=ref_text,
                speed=spd,
                generation_config=gen_config,
            )
            audio = results[0]  # np.ndarray at 24kHz
            sf.write(out_wav, audio, omni.sampling_rate)

        trim_and_normalize(out_wav, norm_wav)

    mp3 = out_dir / "demo_d_omnivoice_clone.mp3"
    concat_with_pacing(SCRIPT, norm_dir, mp3, "demo_d")

    # Copy to test_voices
    pub = REPO_ROOT / "web_vn" / "output" / "test_voices"
    pub.mkdir(parents=True, exist_ok=True)
    shutil.copy2(mp3, pub / mp3.name)

    return mp3


if __name__ == "__main__":
    t0 = time.time()
    mp3 = build_demo_d()
    print(f"\n{'='*60}")
    print(f" DEMO D CREATED IN {time.time()-t0:.1f}s!")
    print(f" D (OmniVoice Clone): {mp3}")
    print(f"{'='*60}")