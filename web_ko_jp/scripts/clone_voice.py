import os
import sys
import torch
import torchaudio
import soundfile as sf
from pathlib import Path

# Đảm bảo UTF-8 cho console
sys.stdout.reconfigure(encoding="utf-8")

SOURCE_WAV = Path(r"D:\VibeCoding\omnivoice\voice\konosuke-matsushita.WAV")
OUTPUT_DIR = Path(r"D:\VibeCoding\auto_YT\web_ko_jp\data\voices")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

REF_SNIPPET_WAV = OUTPUT_DIR / "konosuke_ref_snippet.wav"
PROMPT_PT_PATH = OUTPUT_DIR / "konosuke_matsushita.pt"
DEMO_WAV_PATH = OUTPUT_DIR / "demo_konosuke_sample.wav"

print(f"1. Trích xuất đoạn audio mẫu từ {SOURCE_WAV}...")
# Cắt đoạn 12 giây đầu sạch sẽ
waveform, sr = torchaudio.load(str(SOURCE_WAV))
# Chuyển sang mono nếu stereo
if waveform.shape[0] > 1:
    waveform = torch.mean(waveform, dim=0, keepdim=True)

snippet_duration_sec = 14
max_frames = int(snippet_duration_sec * sr)
# Lấy từ giây thứ 1.0 để tránh tiếng lách cách đầu file
start_frame = int(1.0 * sr)
end_frame = min(start_frame + max_frames, waveform.shape[1])
snippet_waveform = waveform[:, start_frame:end_frame]

torchaudio.save(str(REF_SNIPPET_WAV), snippet_waveform, sr)
print(f"Đã lưu ref snippet: {REF_SNIPPET_WAV} (duration: {round((end_frame - start_frame)/sr, 2)}s)")

print("\n2. Nhận dạng ref_text tiếng Nhật bằng faster-whisper...")
from faster_whisper import WhisperModel
whisper_model = WhisperModel("small", device="cuda" if torch.cuda.is_available() else "cpu", compute_type="float16")
segments, info = whisper_model.transcribe(str(REF_SNIPPET_WAV), language="ja")
ref_text = "".join([segment.text for segment in segments]).strip()
print(f"Detected ref_text: '{ref_text}'")

if not ref_text:
    ref_text = "道は無限にある。"

print("\n3. Nạp model OmniVoice trên CUDA...")
from omnivoice import OmniVoice, VoiceClonePrompt
device = "cuda" if torch.cuda.is_available() else "cpu"
model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map=device, dtype=torch.float16)

print("\n4. Tạo VoiceClonePrompt cho Matsushita Konosuke...")
voice_prompt = model.create_voice_clone_prompt(
    ref_audio=str(REF_SNIPPET_WAV),
    ref_text=ref_text,
    preprocess_prompt=True,
)

voice_prompt.save(str(PROMPT_PT_PATH))
print(f"ĐÃ LƯU THÀNH CÔNG VoiceClonePrompt: {PROMPT_PT_PATH}")

print("\n5. Thử nghiệm sinh giọng đọc tiếng Nhật (Demo Test)...")
test_text = "道は無限にある。志を立てて進むとき、道は必ず開ける。失敗を恐れるな、一歩を踏み出す勇気を持とう。"
print(f"Synthesizing: '{test_text}'")

audios = model.generate(
    text=test_text,
    language="Japanese",
    voice_clone_prompt=voice_prompt,
    num_step=32,
    speed=1.0,
)

sf.write(str(DEMO_WAV_PATH), audios[0], model.sampling_rate)
print(f"ĐÃ TẠO THÀNH CÔNG file audio demo: {DEMO_WAV_PATH}")
print("Done!")
