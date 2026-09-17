# -*- coding: utf-8 -*-
"""
OmniVoice Client & Multi-Speaker Synthesizer
Supports voice cloning for Bac Sam + character voices, chunking, and fallback synthesis.
"""

import os
import sys
import re
import json
import urllib.request
import urllib.error

OMNIVOICE_ENDPOINT = os.getenv("OMNIVOICE_ENDPOINT", "http://127.0.0.1:8000")

SPEAKER_PROFILES = {
    "bac_sam": {
        "name": "Bác Sâm (Host)",
        "voice_id": "bac_sam_v1",
        "ref_audio": "data/voices/bac_sam_ref.wav",
        "speed": 0.95,
        "pitch": 0.0,
        "emotion": "narrative_warm"
    },
    "nhan_vat_chinh": {
        "name": "Nhân vật chính (Tự sự)",
        "voice_id": "tuan_diep_v1",
        "ref_audio": "data/voices/nhan_vat_ref.wav",
        "speed": 1.0,
        "pitch": 0.0,
        "emotion": "reflective_honest"
    },
    "me_chong": {
        "name": "Mẹ chồng (Đanh đá / Cay nghiệt)",
        "voice_id": "me_chong_v1",
        "speed": 1.05,
        "pitch": 0.1,
        "emotion": "harsh"
    },
    "tieu_tam": {
        "name": "Tiểu tam (Xảo quyệt)",
        "voice_id": "tieu_tam_v1",
        "speed": 1.02,
        "pitch": 0.05,
        "emotion": "sweet_cunning"
    }
}

def parse_speaker_blocks(script_text: str):
    """
    Parses a script containing [SPEAKER:xxx] tags into list of (speaker, text) blocks.
    Default speaker is 'nhan_vat_chinh' unless specified or opening intro.
    """
    blocks = []
    current_speaker = "nhan_vat_chinh"
    
    # Check if text starts with bac_sam
    if "(00:01)" in script_text[:50] or "Kính chào quý vị" in script_text[:100] or "bác Sâm" in script_text[:100]:
        current_speaker = "bac_sam"
        
    parts = re.split(r'\[SPEAKER:(\w+)\]', script_text)
    
    if len(parts) == 1:
        blocks.append((current_speaker, parts[0].strip()))
    else:
        # First block before any tag
        if parts[0].strip():
            blocks.append((current_speaker, parts[0].strip()))
        
        # Subsequent tags: odd index is speaker, even index is text
        for i in range(1, len(parts), 2):
            speaker_tag = parts[i]
            block_text = parts[i+1].strip() if i+1 < len(parts) else ""
            if block_text:
                blocks.append((speaker_tag, block_text))
                
    return blocks

def synthesize_text_segment(text: str, speaker_code: str, output_path: str):
    """
    Calls OmniVoice server endpoint. If unavailable, falls back gracefully.
    """
    profile = SPEAKER_PROFILES.get(speaker_code, SPEAKER_PROFILES["nhan_vat_chinh"])
    payload = {
        "text": text,
        "voice_id": profile["voice_id"],
        "ref_audio": profile.get("ref_audio"),
        "speed": profile.get("speed", 1.0),
        "emotion": profile.get("emotion", "neutral")
    }
    
    req_data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        f"{OMNIVOICE_ENDPOINT}/v1/tts/synthesize",
        data=req_data,
        headers={"Content-Type": "application/json"}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            with open(output_path, 'wb') as out_f:
                out_f.write(response.read())
            print(f"[OmniVoice] Synthesized segment for speaker: {speaker_code} -> {output_path}")
            return True
    except Exception as e:
        print(f"[OmniVoice Warning] Endpoint {OMNIVOICE_ENDPOINT} offline ({e}). Generating placeholder audio stub.")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        # Create empty placeholder file if endpoint not yet running
        with open(output_path, 'wb') as f:
            f.write(b'RIFF....WAVEfmt ....data....')
        return False

if __name__ == '__main__':
    sample = "[SPEAKER:bac_sam] Đêm nay bác Sâm xin mời quý vị nghe câu chuyện. [SPEAKER:nhan_vat_chinh] Cháu chào bác Sâm, cháu xin kể lại biến cố vừa qua."
    blocks = parse_speaker_blocks(sample)
    print("Parsed Blocks:", blocks)
