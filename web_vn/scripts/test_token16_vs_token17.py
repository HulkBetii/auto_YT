# -*- coding: utf-8 -*-
"""
A/B Audio Comparison: VieNeu-TTS Token 16 (tu_nhien) vs Token 17 (tin_tuc)
Evaluates prosody, naturalness, and dramatic emotional delivery on story_me_gia_drama_06.
"""

import sys
import os
import time
import json
import subprocess
import re
import soundfile as sf
import numpy as np
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
SCRIPTS_DIR = REPO_ROOT / "web_vn" / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from vieneu import Vieneu
from audio_mixer import get_ffmpeg_bin

STORY_ID = "story_me_gia_drama_06"
STORY_DIR = REPO_ROOT / "web_vn" / "output" / STORY_ID
MANIFEST_PATH = STORY_DIR / "audio_manifest.jsonl"

TEST_ROOT = STORY_DIR / "style_token_comparison"
TEST_ROOT.mkdir(parents=True, exist_ok=True)

TOKEN_16_DIR = TEST_ROOT / "token_16_tu_nhien"
TOKEN_16_DIR.mkdir(parents=True, exist_ok=True)

TOKEN_17_DIR = TEST_ROOT / "token_17_tin_tuc"
TOKEN_17_DIR.mkdir(parents=True, exist_ok=True)


def main():
    print("=" * 70)
    print("🎙️ VIENEU-TTS STYLE COMPARISON: TOKEN 16 (tu_nhien) vs TOKEN 17 (tin_tuc)")
    print(f"Target Story: {STORY_ID}")
    print("=" * 70)

    if not MANIFEST_PATH.exists():
        raise FileNotFoundError(f"Manifest not found at {MANIFEST_PATH}")

    entries = [json.loads(line) for line in MANIFEST_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]

    # Select 4 diverse dialogue/narrative chunks from Chapter 1
    # chunk 1 (bac_sam), chunk 6 (nhan_vat_chinh), chunk 19 (ke_phan_dien_nu), chunk 21 (ke_phan_dien_nam)
    target_indices = [1, 6, 19, 21, 22]
    sample_chunks = [e for e in entries if e.get("chunk_index") in target_indices or e.get("id") in [f"chunk_{i:05d}" for i in target_indices]]
    if not sample_chunks:
        # Fallback to first 5 chunks of chapter 1
        sample_chunks = [e for e in entries if e.get("chapter") == 1][:5]

    print(f"Selected {len(sample_chunks)} representative multi-role chunks:")
    for sc in sample_chunks:
        print(f"  [{sc.get('id')}] ({sc.get('speaker_role')}) {sc.get('text')[:65]}...")

    tts = Vieneu()
    sr = tts.sample_rate

    configs = [
        {"token_id": 16, "name": "Token 16 (tu_nhien - Natural Speech)", "dir": TOKEN_16_DIR, "style_val": 16},
        {"token_id": 17, "name": "Token 17 (tin_tuc - News/Formal Broadcast)", "dir": TOKEN_17_DIR, "style_val": 17},
    ]

    results = {}

    for cfg in configs:
        t_id = cfg["token_id"]
        t_name = cfg["name"]
        out_dir = cfg["dir"]
        style_val = cfg["style_val"]

        print("\n" + "-" * 70)
        print(f"👉 Rendering with {t_name} (style={style_val})...")
        print("-" * 70)

        wav_files = []
        t_start = time.time()

        for idx, chunk in enumerate(sample_chunks, start=1):
            c_id = chunk["id"]
            spk = chunk.get("speaker_role", "nhan_vat_chinh")
            text = chunk["text"]
            ref_audio = chunk.get("ref_audio")
            voice = chunk.get("voice")
            temp = float(chunk.get("temperature", 0.85))

            out_wav = out_dir / f"{c_id}.wav"
            t0 = time.time()

            clean_text = re.sub(r"\[.*?\]", "", text).strip()
            if not clean_text:
                continue

            if ref_audio and not os.path.exists(ref_audio):
                candidate = REPO_ROOT / "web_vn" / "voices" / Path(ref_audio).name
                if candidate.exists():
                    ref_audio = str(candidate)
                else:
                    ref_audio = None

            infer_kwargs = dict(
                style=style_val,
                temperature=temp,
                top_p=0.95,
                top_k=25,
                use_ref_codes=True,
                silence_p=0.15,
                repetition_penalty=1.15
            )

            if ref_audio and os.path.exists(ref_audio):
                audio_arr = tts.infer(clean_text, ref_audio=ref_audio, denoise=True, **infer_kwargs)
            elif voice:
                audio_arr = tts.infer(clean_text, voice=voice, **infer_kwargs)
            else:
                audio_arr = tts.infer(clean_text, **infer_kwargs)

            sf.write(str(out_wav), audio_arr, sr)
            dur = len(audio_arr) / sr
            wav_files.append(out_wav)
            print(f"  [{idx}/{len(sample_chunks)}] Generated {c_id} [{spk}] ({dur:.2f}s) in {time.time()-t0:.2f}s")

        elapsed = time.time() - t_start

        # Concatenate audio chunks with 250ms silence between chunks
        silence_pad = np.zeros(int(sr * 0.25), dtype=np.float32)
        master_audio_list = []
        for wf in wav_files:
            data, _ = sf.read(str(wf))
            master_audio_list.append(data)
            master_audio_list.append(silence_pad)

        master_arr = np.concatenate(master_audio_list[:-1]) if master_audio_list else np.zeros(sr, dtype=np.float32)
        master_wav = out_dir / f"master_token_{t_id}.wav"
        master_mp3 = out_dir / f"master_token_{t_id}.mp3"

        sf.write(str(master_wav), master_arr, sr)
        total_dur = len(master_arr) / sr

        # Export normalized MP3 via ffmpeg
        ffmpeg = get_ffmpeg_bin()
        cmd = [
            ffmpeg, "-y", "-i", str(master_wav),
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-ar", "48000", "-b:a", "192k",
            str(master_mp3)
        ]
        subprocess.run(cmd, check=True, capture_output=True)

        results[t_id] = {
            "name": t_name,
            "master_wav": str(master_wav),
            "master_mp3": str(master_mp3),
            "duration": round(total_dur, 2),
            "render_time": round(elapsed, 2)
        }
        print(f"✅ {t_name} Master exported: {master_mp3} ({total_dur:.2f}s)")

    print("\n" + "=" * 70)
    print("📊 COMPARISON SUMMARY:")
    print("=" * 70)
    for t_id, r in results.items():
        print(f"• Token {t_id}: Duration = {r['duration']}s | Render Time = {r['render_time']}s")
        print(f"  MP3 Link: {r['master_mp3']}")

    summary_file = TEST_ROOT / "comparison_summary.json"
    summary_file.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSaved summary to: {summary_file}")


if __name__ == "__main__":
    main()
