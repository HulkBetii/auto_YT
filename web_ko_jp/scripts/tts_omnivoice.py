import argparse
import sys
from pathlib import Path
import torch
import soundfile as sf
from omnivoice import OmniVoice, VoiceClonePrompt

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent.parent
VOICES_DIR = BASE_DIR / "data" / "voices"

def synthesize_speech(
    text: str,
    output_path: str,
    voice_name: str = "konosuke_matsushita",
    speed: float = 1.0,
    guidance_scale: float = 3.0,
    position_temperature: float = 3.0,
    num_step: int = 36,
    audio_chunk_duration: float = 20.0,
    device: str = "cuda" if torch.cuda.is_available() else "cpu",
):
    prompt_path = VOICES_DIR / f"{voice_name}.pt"
    if not prompt_path.exists():
        raise FileNotFoundError(f"Voice prompt not found: {prompt_path}")

    print(f"Loading VoiceClonePrompt from {prompt_path}...")
    voice_prompt = VoiceClonePrompt.load(str(prompt_path), map_location=device)

    print(f"Loading OmniVoice on {device}...")
    model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map=device, dtype=torch.float16)

    print(f"Synthesizing Japanese text ({len(text)} chars) with optimal parameters:")
    print(f"  guidance_scale={guidance_scale}, position_temp={position_temperature}, num_step={num_step}, speed={speed}")
    
    audios = model.generate(
        text=text,
        language="Japanese",
        voice_clone_prompt=voice_prompt,
        num_step=num_step,
        speed=speed,
        guidance_scale=guidance_scale,
        position_temperature=position_temperature,
        audio_chunk_duration=audio_chunk_duration,
    )

    out_file = Path(output_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_file), audios[0], model.sampling_rate)
    print(f"Synthesized audio saved to: {out_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OmniVoice Japanese TTS synthesizer")
    parser.add_argument("--text", required=True, help="Text to speak")
    parser.add_argument("--output", required=True, help="Output WAV path")
    parser.add_argument("--voice", default="konosuke_matsushita", help="Voice prompt name")
    parser.add_argument("--speed", type=float, default=1.0, help="Speech speed factor")
    parser.add_argument("--guidance_scale", type=float, default=3.0, help="Guidance scale")
    parser.add_argument("--position_temperature", type=float, default=3.0, help="Position temperature")
    parser.add_argument("--num_step", type=int, default=36, help="Inference diffusion steps")
    args = parser.parse_args()

    synthesize_speech(
        text=args.text,
        output_path=args.output,
        voice_name=args.voice,
        speed=args.speed,
        guidance_scale=args.guidance_scale,
        position_temperature=args.position_temperature,
        num_step=args.num_step,
    )

