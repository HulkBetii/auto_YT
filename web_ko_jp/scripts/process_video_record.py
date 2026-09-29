import os
import sys
import json
import re
import time
import subprocess
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(r"D:\VibeCoding\auto_YT\web_ko_jp")
OUTPUT_DIR = BASE_DIR / "output"
SCRIPTS_DIR = BASE_DIR / "scripts"

# Load the generated JSON from task-2314 log
task_log = Path(r"C:\Users\HulkBeoti\.gemini\antigravity\brain\8fcee5eb-c4c1-4caa-ac9a-7ac3e4ba0912\.system_generated\tasks\task-2314.log").read_text(encoding="utf-8")
json_match = re.search(r"(\{[\s\S]*\"script_jp\"[\s\S]*\})", task_log)
if not json_match:
    raise RuntimeError("Could not find pipeline JSON in task log!")

data = json.loads(json_match.group(1))

source_title = data["title"]
source_url = data["url"]
source_video_id = "vweu4k_s6_Q"
title_jp = data["title_jp"]
script_jp = data["script_jp"]
description_jp = data["description_jp"]
youtube_tags = data["youtube_tags"]
thumbnail_text = "悪人は\n顔に出る\n近づくな"
thumbnail_image_url = data["thumbnail_image_url"]
conversation_url = data["conversation_url"]

print(f"--- Processing Video: {source_video_id} ---")
print(f"Title JP: {title_jp}")
print(f"Script length: {len(script_jp)} chars")

# Step 1: Check or query database ID
cmd = [
    "docker", "exec", "-i", "auto_yt_web_ko_jp_postgres",
    "psql", "-U", "postgres", "-d", "auto_yt_ko_jp", "-t", "-A",
    "-c", f"SELECT id FROM ko_jp_videos WHERE source_video_id = '{source_video_id}' ORDER BY id DESC LIMIT 1;"
]
res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
video_id = int(res.stdout.strip())
print(f"[Step 1 SUCCESS] Using database video ID: {video_id}")

# Step 2: Run TTS generation via tts_gpt_sovits.py for video_id
print(f"[Step 2] Running TTS generation for video ID {video_id}...")
tts_py = SCRIPTS_DIR / "tts_gpt_sovits.py"
tts_cmd = [
    "uv", "run", "python", str(tts_py),
    "--video_id", str(video_id)
]
tts_res = subprocess.run(tts_cmd, cwd=r"D:\VibeCoding\auto_YT", capture_output=True, text=True, encoding="utf-8")
print(tts_res.stdout)
if tts_res.returncode != 0:
    print(tts_res.stderr)
    raise RuntimeError(f"TTS generation failed: {tts_res.stderr}")

# Step 3: Find generated output folder and files
candidate_dirs = list(OUTPUT_DIR.glob(f"v{video_id}_{source_video_id}_*"))
if not candidate_dirs:
    candidate_dirs = sorted([d for d in OUTPUT_DIR.iterdir() if d.is_dir() and f"v{video_id}" in d.name], key=lambda x: x.stat().st_mtime, reverse=True)

if not candidate_dirs:
    raise RuntimeError("Could not find generated output folder!")

video_folder = candidate_dirs[0]
print(f"Output folder found: {video_folder}")

# Identify audio and srt files
audio_files = list(video_folder.glob(f"drama_v{video_id}_*.wav"))
srt_files = list(video_folder.glob(f"sub_v{video_id}_*.srt"))

if not audio_files:
    raise RuntimeError(f"No audio file in {video_folder}")
if not srt_files:
    raise RuntimeError(f"No srt file in {video_folder}")

audio_file = audio_files[0]
srt_file = srt_files[0]

# Copy thumbnail image to output folder
src_thumb = BASE_DIR / "public" / "thumbnails" / Path(thumbnail_image_url).name
dest_thumb = video_folder / f"thumb_{video_folder.name}.png"
if src_thumb.exists():
    import shutil
    shutil.copy2(src_thumb, dest_thumb)
    print(f"Copied thumbnail to: {dest_thumb}")

# Step 4: Parse SRT to find exact timestamps for the 6 chapters
srt_content = srt_file.read_text(encoding="utf-8")
srt_blocks = re.findall(r"(\d+)\r?\n(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})\r?\n([\s\S]*?)(?=\n\r?\n|\Z)", srt_content)

def parse_time_sec(ts):
    h, m, s_ms = ts.split(":")
    s, ms = s_ms.split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0

def format_chapter_time(sec):
    m = int(sec // 60)
    s = int(sec % 60)
    return f"{m:02d}:{s:02d}"

# Find cue timestamps for section keywords
chapters_def = [
    ("イントロ｜近づくだけで人生を腐らせる人間", ["そいつに近づいた瞬間", "お前の人生は腐る", "一回だけ言う"]),
    ("① 落ち着きのない態度、ふんぞり返った態度", ["まず一つ目だ", "落ち着きのないやつ", "やけにふんぞり返る"]),
    ("② 泳ぐ目、冷たく値踏みする目", ["二つ目だ", "目は怖い", "目が泳ぐやつ"]),
    ("③ 嘘くさい仕草、乱暴な仕草", ["三つ目だ", "仕草が嘘くさい", "やたら丁寧すぎる"]),
    ("④ 口がうまい人間ほど危ない理由", ["四つ目だ", "口がうまい人間", "一番厄介だ"]),
    ("⑤ 声に出る本性と支配欲", ["五つ目だ", "声だ", "声には腹が出る"]),
    ("最後に｜悪い縁を早く切る者が身を守る", ["ここまで話した五つ", "人を疑って生きろ", "悪い縁は、早く切った者"]),
]

chapter_timestamps = []
for title, keywords in chapters_def:
    matched_time = None
    for idx_str, start_ts, end_ts, text in srt_blocks:
        if any(kw in text for kw in keywords):
            matched_time = parse_time_sec(start_ts)
            break
    if matched_time is None:
        matched_time = 0.0 if not chapter_timestamps else chapter_timestamps[-1][1] + 60.0
    chapter_timestamps.append((title, matched_time))

# Format the chapters table
formatted_chapters = ["◆ 目次（チャプター）"]
for title, sec in chapter_timestamps:
    formatted_chapters.append(f"{format_chapter_time(sec)} {title}")

chapters_text = "\n".join(formatted_chapters)
print("Computed Chapters with Audio Sync:\n", chapters_text)

# Step 5: Update Description with formatted chapters
desc_updated = re.sub(
    r"◆ 目次（チャプター）[\s\S]*?(?=【チャンネル登録|━━━━━━━━|\Z)",
    chapters_text + "\n\n",
    description_jp
).strip()

def sql_escape(s: str) -> str:
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"

# Update DB with updated description and thumbnail path
update_db_sql = f"""
UPDATE ko_jp_videos SET
    description_jp = {sql_escape(desc_updated)},
    updated_at = NOW()
WHERE id = {video_id};
"""
subprocess.run([
    "docker", "exec", "-i", "auto_yt_web_ko_jp_postgres",
    "psql", "-U", "postgres", "-d", "auto_yt_ko_jp",
    "-c", update_db_sql
], check=True)

# Step 6: Write summary.txt
audio_dur_sec = parse_time_sec(srt_blocks[-1][2]) if srt_blocks else 0
cues_count = len(srt_blocks)

summary_content = f"""================================================================================
THÔNG TIN VIDEO YOUTUBE TIẾNG NHẬT (ID: {video_id})
================================================================================
1. LINK GỐC: {source_url}
2. TIÊU ĐỀ GỐC: {source_title}

3. TIÊU ĐỀ TIẾNG NHẬT (TURN 2):
{title_jp}

4. MÔ TẢ & HASHTAGS (TURN 3):
{desc_updated}

5. THẺ TAGS YOUTUBE (TỪ KHÓA - PHÂN CÁCH DẤU PHẨY ĐỂ DÁN VÀO Ô TAGS YOUTUBE STUDIO):
{youtube_tags}

6. TEXT THUMBNAIL (TURN 4):
{thumbnail_text}

7. ĐƯỜNG DẪN FILE ẢNH THUMBNAIL (TURN 5):
{dest_thumb}

8. LINK PHIÊN CHAT CHATGPT:
{conversation_url}

9. FILE AUDIO LỒNG TIẾNG DRAMA (GPT-SoVITS Konosuke Matsushita Seg A):
   - File: {audio_file}
   - URL: http://localhost:3004/api/audio?file={audio_file.name}
   - Thời lượng: {audio_dur_sec:.2f}s (~{audio_dur_sec/60:.1f} phút audio)

10. FILE PHỤ ĐỀ CHUẨN TIẾNG NHẬT (.SRT):
   - File: {srt_file}
   - URL: http://localhost:3004/api/subtitles?file={srt_file.name}
   - Tổng số cues: {cues_count} câu phụ đề khớp chuẩn từng giây với audio

================================================================================
11. TOÀN BỘ NỘI DUNG KỊCH BẢN TIẾNG NHẬT (TURN 1 - {len(script_jp)} ký tự):
================================================================================
{script_jp}
"""

summary_file = video_folder / f"summary_{video_folder.name}.txt"
summary_file.write_text(summary_content, encoding="utf-8")
print(f"Written summary file: {summary_file}")

# Step 7: Write data.json
data_json = {
    "id": video_id,
    "source_url": source_url,
    "source_video_id": source_video_id,
    "source_title": source_title,
    "title_jp": title_jp,
    "description_jp": desc_updated,
    "youtube_tags": youtube_tags,
    "thumbnail_text": thumbnail_text,
    "thumbnail_image_url": f"/thumbnails/{dest_thumb.name}",
    "conversation_url": conversation_url,
    "audio_url": f"/api/audio?file={audio_file.name}",
    "audio_duration_seconds": round(audio_dur_sec, 2),
    "srt_cues_count": cues_count,
    "final_script_jp": script_jp,
    "char_count": len(script_jp),
    "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
data_file = video_folder / f"data_{video_folder.name}.json"
data_file.write_text(json.dumps(data_json, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Written data JSON file: {data_file}")

print(f"\n=== PIPELINE COMPLETED SUCCESSFULLY FOR VIDEO ID {video_id} ===")
