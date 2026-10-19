import json
from pathlib import Path

manifest_path = Path(r"web_vn/output/story_bo_chong_drama_04/audio_manifest.jsonl")
chapters = {}
total_chunks = 0
total_dur = 0.0

with open(manifest_path, encoding="utf-8") as f:
    for line in f:
        data = json.loads(line)
        c_num = data.get("chapter", 1)
        dur = data.get("duration_s", 0.0)
        spk = data.get("voice_id", "unknown")
        
        if c_num not in chapters:
            chapters[c_num] = {
                "start_time": total_dur,
                "duration": 0.0,
                "chunk_count": 0,
                "speakers": set()
            }
        chapters[c_num]["duration"] += dur
        chapters[c_num]["chunk_count"] += 1
        chapters[c_num]["speakers"].add(spk)
        total_dur += dur
        total_chunks += 1

print(f"Total Chunks: {total_chunks}, Total Duration: {total_dur/60:.2f} mins\n")
print("=== CHAPTER BREAKDOWN & TIMESTAMPS ===")
for c_num in sorted(chapters.keys()):
    info = chapters[c_num]
    st = info["start_time"]
    m = int(st // 60)
    s = int(st % 60)
    dur_m = info["duration"] / 60
    spks = ", ".join(sorted(info["speakers"]))
    chunks = info["chunk_count"]
    print(f"Chương {c_num:2d} | Mốc {m:02d}:{s:02d} ({st:7.1f}s) | Dài: {dur_m:4.1f}p ({chunks:2d} chunks) | Vai: [{spks}]")
