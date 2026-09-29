# -*- coding: utf-8 -*-
"""
Generate a full ~5-minute dramatic demo (30 chunks, ~5.0 - 5.5 mins) with all 5 new audio clones.
Includes full dramatic arc: Confrontation -> Eviction in the rain -> Return to parents -> Discovery of forgery.
VieNeu-TTS v3 Turbo 48kHz, zero emotion tags, dramatic pacing, EBU R128.
"""

import sys
import os
import time
import subprocess
import soundfile as sf
import numpy as np
import librosa
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
out_dir = REPO_ROOT / "web_vn" / "output" / "demo_5min_full"
out_dir.mkdir(parents=True, exist_ok=True)

DOWNLOADS = Path(r"C:\Users\HulkBeoti\Downloads")

# Extended 30-chunk dramatic script (~1,000 words -> exactly ~5.0 - 5.3 mins audio)
SCRIPT = [
    # 1. Bác Sâm mở màn
    {
        "id": "full5m_01",
        "role": "bac_sam",
        "text": "Kính chào quý vị và các bạn đang lắng nghe Sâm kể chuyện. Đêm nay, bác Sâm xin mời quý vị ngồi lại thật chậm để cùng chiêm nghiệm một câu chuyện gia đình.",
    },
    {
        "id": "full5m_02",
        "role": "bac_sam",
        "text": "Có những cuộc hôn nhân không đổ vỡ vào ngày người ta ký vào lá đơn ly hôn, mà nó đã rạn nứt từ rất lâu rồi. Chỉ là người trong cuộc cứ cố cúi xuống nhặt từng mảnh vỡ, để rồi tự cứa vào tay mình.",
    },
    # 2. Nữ chính tự thuật
    {
        "id": "full5m_03",
        "role": "nu_chinh",
        "text": "Cháu chào bác Sâm và quý vị thính giả. Cháu tên là Minh Hà. Năm biến cố ấy xảy ra, cháu ba mươi tư tuổi. Cho đến tận bây giờ, mỗi khi trời mưa lớn về đêm, cháu vẫn nhớ như in tiếng chiếc vali va vào bậc đá trước hiên nhà.",
    },
    {
        "id": "full5m_04",
        "role": "nu_chinh",
        "text": "Chiều hôm ấy, cháu tan làm muộn sau ca trực dài. Vừa lái xe vào sân, cháu đã thấy một đôi giày cao gót màu kem đặt ngay ngắn trên tấm thảm trước cửa, bên cạnh là chiếc ô cán vàng vẫn còn nhỏ nước.",
    },
    # 3. Mẹ chồng và Tiểu tam trong phòng khách
    {
        "id": "full5m_05",
        "role": "me_chong",
        "text": "Ăn thêm chút hoa quả đi con! Người mang thai phải ăn cho hai người, chứ ăn như mèo thế này thì cháu nội đích tôn của tôi lấy gì mà lớn?",
    },
    {
        "id": "full5m_06",
        "role": "tieu_tam",
        "text": "Dạ, mẹ cứ lo cho em quá. Anh Hưng chăm sóc em chu đáo lắm ạ. Anh ấy bảo mẹ con em là điều quý giá nhất của anh ấy bây giờ.",
    },
    # 4. Nữ chính bước vào, Chồng xuất hiện
    {
        "id": "full5m_07",
        "role": "nu_chinh",
        "text": "Bước vào phòng khách, cháu sững người khi thấy mẹ chồng đang ân cần bên cạnh Thanh Vy, cô nhân viên đối tác của công ty chồng. Đúng lúc đó, Hưng từ trên tầng hai bước xuống.",
    },
    {
        "id": "full5m_08",
        "role": "nu_chinh",
        "text": "Anh về lúc nào thế? Sao không nhắn cho em một câu?",
    },
    {
        "id": "full5m_09",
        "role": "chong",
        "text": "Tôi về lúc năm giờ. Tôi quên. Mà cô về rồi thì ngồi xuống đây, chúng ta nói chuyện thẳng thắn với nhau một lần cho xong.",
    },
    # 5. Màn đối chất ly hôn
    {
        "id": "full5m_10",
        "role": "chong",
        "text": "Tôi không vòng vo nữa! Vy đã có thai con trai nối dõi cho dòng họ này gần bốn tháng rồi! Tình cảm giữa chúng ta lâu nay cũng cạn kiệt, cô mau ký vào đơn ly hôn đi!",
    },
    {
        "id": "full5m_11",
        "role": "tieu_tam",
        "text": "Chị Hà ơi... em biết nói gì lúc này chị cũng đau lòng. Nhưng em và anh Hưng là tình yêu thật lòng. Chị lớn tuổi rồi, nhan sắc tàn tạ, buông tay để anh ấy lo cho mẹ con em đi chị.",
    },
    {
        "id": "full5m_12",
        "role": "me_chong",
        "text": "Cô đừng có làm căng làm ầm ĩ lên! Cái loại cau điếc tám năm trời không đẻ nổi một mụn con thì lấy tư cách gì làm dâu nhà này? Tối nay dọn hết đồ đạc ra khỏi nhà tôi ngay!",
    },
    # 6. Nữ chính lật màn
    {
        "id": "full5m_13",
        "role": "nu_chinh",
        "text": "Tám năm qua, từ những ngày anh đi đôi dép đứt quai phải buộc dây thép, đến số vàng hồi môn mẹ tôi trao ngày cưới để anh có vốn mở công ty... Giờ anh bảo tôi ra đi tay trắng sao?",
    },
    {
        "id": "full5m_14",
        "role": "nu_chinh",
        "text": "Các người nghĩ tôi là đứa ngu ngốc cam chịu sao? Căn biệt thự mười hai tỷ này vốn đứng tên riêng của tôi trước hôn nhân! Tôi chưa từng ký bất kỳ giấy ủy quyền nào cả!",
    },
    {
        "id": "full5m_15",
        "role": "chong",
        "text": "Cô nói cái gì? Căn nhà này là tiền mồ hôi nước mắt của tôi! Cô đừng hòng bịa chuyện để chiếm đoạt tài sản!",
    },
    {
        "id": "full5m_16",
        "role": "me_chong",
        "text": "Trời đất ơi! Đã không biết đẻ còn bày đặt đòi chia nhà! Chị cút ngay ra khỏi cửa cho khuất mắt tôi!",
    },
    # 7. Nữ chính dứt khoát ra đi trong mưa
    {
        "id": "full5m_17",
        "role": "nu_chinh",
        "text": "Cháu không thèm tranh cãi thêm một lời nào. Cháu lên phòng, kéo chiếc vali cũ tám năm trước theo cháu về nhà chồng, rồi lặng lẽ bước từng bậc xuống cầu thang.",
    },
    {
        "id": "full5m_18",
        "role": "tieu_tam",
        "text": "Chị dọn xong rồi à? Nhớ mang hết đồ cá nhân đi nhé, sau này đỡ phải quay lại phiền phức.",
    },
    {
        "id": "full5m_19",
        "role": "nu_chinh",
        "text": "Cháu đặt chùm chìa khóa lên kệ giày. Tiếng kim loại va vào mặt gỗ nghe thật khô khốc. Cánh cổng sắt sau lưng cháu đóng sập lại giữa màn mưa đêm lạnh buốt.",
    },
    # 8. Bác Sâm chuyển cảnh
    {
        "id": "full5m_20",
        "role": "bac_sam",
        "text": "Đêm mưa ấy, người đàn bà bước ra đi trong sự hả hê của những kẻ bội bạc. Chiếc xe lăn bánh trong đêm đưa Minh Hà trở về ngôi nhà của bố mẹ đẻ, nơi ánh đèn vàng nơi gian bếp vẫn luôn sáng đợi con gái.",
    },
    # 9. Trở về nhà bố mẹ đẻ
    {
        "id": "full5m_21",
        "role": "nu_chinh",
        "text": "Cháu về tới nhà bố mẹ đã hơn chín giờ đêm. Thấy cháu kéo vali vào trong mưa, mẹ cháu không hỏi một lời nào, chỉ lặng lẽ lấy khăn lau nước mưa trên tóc cháu, rồi bưng lên bát canh nóng.",
    },
    {
        "id": "full5m_22",
        "role": "nu_chinh",
        "text": "Bố cháu ngồi đối diện, nhấp một ngụm trà nguội rồi bảo: Con muốn bố can thiệp hay tự con giải quyết? Cháu đáp: Con tự giải quyết. Bố gật đầu: Tự giải quyết, nhưng không có nghĩa là phải chịu đựng một mình.",
    },
    # 10. Hai ngày sau - Sự thật về căn nhà
    {
        "id": "full5m_23",
        "role": "bac_sam",
        "text": "Tại căn biệt thự mười hai tỷ, Thanh Vy lập tức dọn đồ vào ở, vứt bỏ toàn bộ ảnh cưới và đồ đạc của Minh Hà. Còn Hưng thì ráo riết gửi văn bản yêu cầu ly hôn hòng tẩu tán tài sản.",
    },
    {
        "id": "full5m_24",
        "role": "chong",
        "text": "Tôi đã gửi thỏa thuận ly hôn qua thư điện tử rồi. Cô xem và ký sớm đi! Chuyện đã thế này, kéo dài chẳng có ích gì cho cô đâu!",
    },
    {
        "id": "full5m_25",
        "role": "nu_chinh",
        "text": "Sao anh vội thế? Anh sợ điều gì à? Giấy tờ liên quan đến tài sản của tôi, tôi sẽ đọc từng chữ một.",
    },
    {
        "id": "full5m_26",
        "role": "chong",
        "text": "Có gì mà phải đọc kỹ? Toàn bộ tài sản chung chia theo luật định. Tôi sẽ không để cô phải thiệt thòi đâu mà lo!",
    },
    # 11. Cuộc gọi từ văn phòng công chứng & Đại twist
    {
        "id": "full5m_27",
        "role": "nu_chinh",
        "text": "Đến chiều ngày thứ ba, bàn làm việc của cháu bất ngờ nhận được cuộc gọi từ văn phòng công chứng. Đầu dây bên kia là giọng một chuyên viên rà soát hồ sơ bất động sản.",
    },
    {
        "id": "full5m_28",
        "role": "nu_chinh",
        "text": "Họ hỏi: Xin hỏi chị Nguyễn Minh Hà có từng ký văn bản ủy quyền định đoạt căn biệt thự cho ông Đức Hưng không? Cháu ngồi thẳng lưng, trả lời dứt khoát: Tôi chưa từng ký bất kỳ giấy ủy quyền nào cả!",
    },
    {
        "id": "full5m_29",
        "role": "nu_chinh",
        "text": "Đầu dây bên kia im lặng mất hai giây rồi mời cháu qua làm việc khẩn cấp. Lúc ấy, sống lưng cháu lạnh buốt khi nhận ra một âm mưu làm giả chữ ký để chiếm đoạt tài sản đã được chuẩn bị từ lâu.",
    },
    # 12. Bác Sâm đúc kết kết thúc
    {
        "id": "full5m_30",
        "role": "bac_sam",
        "text": "Quý vị và các bạn thân mến, lòng tham và sự phản bội khi đã đi quá giới hạn sẽ tự đào hố chôn vùi chính kẻ thủ ác. Và người đàn bà từng nhẫn nhịn tám năm, giờ đây sẽ dùng chính sự thật và pháp luật để đòi lại tất cả công bằng.",
    },
]

SILENCE_SAME_ROLE = 0.50
SILENCE_TURN_CHANGE = 0.90
SILENCE_NARRATOR = 1.35

def create_silence_wav(duration, out_path, sr=48000):
    sf.write(out_path, np.zeros(int(duration * sr), dtype=np.float32), sr)

def trim_and_normalize(in_wav, out_wav, top_db=30, buffer_sec=0.12):
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
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
        str(out_wav)
    ], check=True, capture_output=True)
    if temp.exists():
        temp.unlink()

def main():
    t0 = time.time()
    print("=" * 65)
    print(">>> GENERATING FULL 5-MINUTE CONTINUOUS DEMO (30 CHUNKS) <<<")
    print("=" * 65)

    from vieneu import Vieneu
    tts = Vieneu()

    chunks_dir = out_dir / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    norm_dir = out_dir / "norm"
    norm_dir.mkdir(parents=True, exist_ok=True)

    voice_map = {
        "bac_sam":   {"ref_audio": str(DOWNLOADS / "bac-sam.mp3"),   "style": "doc_truyen", "temp": 0.82},
        "nu_chinh":  {"ref_audio": str(DOWNLOADS / "nu-chinh.mp3"),  "style": "doc_truyen", "temp": 0.80},
        "me_chong":  {"ref_audio": str(DOWNLOADS / "me-chong.mp3"),  "style": "tu_nhien",   "temp": 0.85},
        "tieu_tam":  {"ref_audio": str(DOWNLOADS / "tieu-tam.mp3"),  "style": "tu_nhien",   "temp": 0.84},
        "chong":     {"ref_audio": str(DOWNLOADS / "nguoi-chong.mp3"), "style": "tu_nhien", "temp": 0.78},
    }

    for idx, item in enumerate(SCRIPT, 1):
        cfg = voice_map[item["role"]]
        text = item["text"]
        out_wav = chunks_dir / f"{item['id']}.wav"
        norm_wav = norm_dir / f"{item['id']}.wav"
        pct = (idx / len(SCRIPT)) * 100

        # Cached check
        if norm_wav.exists() and norm_wav.stat().st_size > 1000:
            print(f"  [{idx:02d}/{len(SCRIPT)}] ({pct:5.1f}%) {item['id']} [{item['role']:12s}] -> Cached")
            continue

        print(f"  [{idx:02d}/{len(SCRIPT)}] ({pct:5.1f}%) {item['id']} [{item['role']:12s}] -> \"{text[:40]}...\"")

        audio = tts.infer(
            text,
            ref_audio=cfg["ref_audio"],
            style=cfg["style"],
            temperature=cfg["temp"],
            top_p=0.95,
            top_k=25,
            use_ref_codes=True,
            denoise=True,
        )
        sf.write(out_wav, audio, tts.sample_rate)
        trim_and_normalize(out_wav, norm_wav)

    # Concat master audio with dramatic pacing
    print("\n=== CONCATENATING 5-MINUTE MASTER AUDIO ===")
    sil_same = out_dir / "sil_same.wav"
    sil_turn = out_dir / "sil_turn.wav"
    sil_narr = out_dir / "sil_narr.wav"
    create_silence_wav(SILENCE_SAME_ROLE, sil_same)
    create_silence_wav(SILENCE_TURN_CHANGE, sil_turn)
    create_silence_wav(SILENCE_NARRATOR, sil_narr)

    concat_file = out_dir / "concat_list.txt"
    with concat_file.open("w", encoding="utf-8") as f:
        prev_role = None
        for item in SCRIPT:
            wav = norm_dir / f"{item['id']}.wav"
            if not wav.exists():
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

    master_wav = out_dir / "demo_5min_full_master.wav"
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_file), "-c:a", "pcm_s16le", str(master_wav)
    ], check=True, capture_output=True)

    final_mp3 = REPO_ROOT / "web_vn" / "output" / "demo_5min_clean.mp3"
    subprocess.run([
        "ffmpeg", "-y", "-i", str(master_wav),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-b:a", "192k", str(final_mp3)
    ], check=True, capture_output=True)

    # Copy to test_voices for browser streaming
    stream_mp3 = REPO_ROOT / "web_vn" / "output" / "test_voices" / "demo_5min_clean.mp3"
    stream_mp3.parent.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copy2(final_mp3, stream_mp3)

    data, sr = sf.read(final_mp3)
    dur = len(data) / sr

    print("\n" + "=" * 65)
    print(f" FULL 5-MINUTE DEMO COMPLETED IN {time.time() - t0:.1f}s!")
    print(f" Total Chunks: {len(SCRIPT)}")
    print(f" Audio Duration: {dur:.1f}s ({dur/60:.2f} mins)")
    print(f" Output File: {final_mp3.resolve()}")
    print(f" Web Stream: http://localhost:3005/api/audio?file=test_voices/demo_5min_clean.mp3")
    print("=" * 65)

if __name__ == "__main__":
    main()