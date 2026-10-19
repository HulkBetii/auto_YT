import json
from pathlib import Path

manifest_path = Path("web_vn/output/story_bo_chong_drama_04/audio_manifest.jsonl")
srt_path = Path("web_vn/output/story_bo_chong_drama_04/full_story_subtitles.srt")

srt_blocks = srt_path.read_text(encoding="utf-8").strip().split("\n\n")

chapters = {}
for i, line in enumerate(manifest_path.read_text(encoding="utf-8").strip().split("\n")):
    if not line.strip():
        continue
    data = json.loads(line)
    c_num = data.get("chapter", 1)
    
    if c_num not in chapters and i < len(srt_blocks):
        b = srt_blocks[i].split("\n")
        time_line = b[1] if len(b) > 1 else ""
        st_str = time_line.split(" --> ")[0] if " --> " in time_line else "00:00:00"
        text_prev = b[2] if len(b) > 2 else ""
        chapters[c_num] = {
            "chunk_idx": i + 1,
            "start_timestamp": st_str,
            "first_text": text_prev[:50]
        }

print("=== 10 CHAPTERS EXACT TIMESTAMPS & CUES ===")
for c_num, info in sorted(chapters.items()):
    ts = info["start_timestamp"]
    chk = info["chunk_idx"]
    txt = info["first_text"]
    print(f"Chương {c_num:2d} | Start: {ts} | Chunk #{chk:3d} | \"{txt}...\"")
