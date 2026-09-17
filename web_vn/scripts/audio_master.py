# -*- coding: utf-8 -*-
"""
Audio Mastering Engine:
- Stitches chapter audio chunks
- Normalizes audio to -16 LUFS (YouTube audio drama standard)
- Mixes background music loop (BGM) with auto-ducking (-20dB under speech)
"""

import os
import subprocess
import sys

def master_final_audio(speech_audio_path: str, bgm_path: str, output_path: str):
    """
    Uses FFmpeg with sidechain ducking and loudnorm filter
    """
    if not os.path.exists(speech_audio_path):
        print(f"[Error] Speech audio not found: {speech_audio_path}")
        return False
        
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    if os.path.exists(bgm_path):
        # Full mix with auto ducking
        cmd = [
            'ffmpeg', '-y',
            '-i', speech_audio_path,
            '-stream_loop', '-1', '-i', bgm_path,
            '-filter_complex',
            '[1:a]volume=0.15,asplit[bgm1][bgm2];[bgm1][0:a]sidechaincompress=threshold=0.08:ratio=5:attack=100:release=800[ducked_bgm];[0:a][ducked_bgm]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-16:TP=-1.5:LRA=11[aout]',
            '-map', '[aout]',
            '-c:a', 'libmp3lame', '-b:a', '320k',
            output_path
        ]
    else:
        # Normalize speech only
        cmd = [
            'ffmpeg', '-y',
            '-i', speech_audio_path,
            '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
            '-c:a', 'libmp3lame', '-b:a', '320k',
            output_path
        ]
        
    try:
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            print(f"[AudioMaster] Mastered audio saved: {output_path}")
            return True
        else:
            print(f"[AudioMaster Warning] FFmpeg notice: {res.stderr[:200]}")
            return False
    except Exception as e:
        print(f"[AudioMaster Error]: {e}")
        return False

if __name__ == '__main__':
    print("Audio Master Engine ready.")
