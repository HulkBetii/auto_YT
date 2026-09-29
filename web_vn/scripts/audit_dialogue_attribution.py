# -*- coding: utf-8 -*-
import sys
import json
import re
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
import argparse
parser = argparse.ArgumentParser(description="Audit dialogue attribution")
parser.add_argument("--story-id", type=str, default="story_me_gia_03", help="Story ID")
args, _ = parser.parse_known_args()

s_name = args.story_id if args.story_id.startswith("story_") else f"story_{args.story_id}"
story_dir = REPO_ROOT / "web_vn" / "output" / s_name
manifest_path = story_dir / "audio_manifest.jsonl"
script_path = story_dir / "full_story_script.md"


if not manifest_path.exists():
    print("Manifest not found.")
    sys.exit(1)

chunks = [json.loads(line) for line in manifest_path.read_text(encoding="utf-8").splitlines() if line.strip()]

print(f"=== AUDIT REPORT: DIALOGUE & SPEAKER ATTRIBUTION ({story_dir.name}) ===")
print(f"Total Chunks in Manifest: {len(chunks)}")

# Distribution
dist = {}
for c in chunks:
    spk = c.get("speaker_id", "unknown")
    dist[spk] = dist.get(spk, 0) + 1

print("\n1. SPEAKER DISTRIBUTION:")
for spk, count in dist.items():
    pct = (count / len(chunks)) * 100
    print(f"  - {spk:20s}: {count:4d} chunks ({pct:5.1f}%)")

narrator_mismatches = []
child_mismatches = []
daughter_in_law_mismatches = []
other_dialogues_in_main = []

for c in chunks:
    cid = c.get("id")
    role = c.get("speaker_id")
    text = c.get("text", "")
    chap = c.get("chapter")

    # Check 1: Host Narrator spoken by other roles
    if role != "bac_sam":
        if any(w in text.lower() for w in ["sâm kể chuyện", "kính chào quý vị", "câu chuyện hôm nay", "quý vị và các bạn"]):
            narrator_mismatches.append((cid, chap, role, "bac_sam", text))

    # Check 2: Child / Son / Others speaking lines attributed to nhan_vat_chinh (Mẹ già)
    if role == "nhan_vat_chinh":
        # Look for dialogue markers or direct quotes
        direct_son_phrases = [
            "Mẹ ơi, bố về rồi!",
            "Chị Lành… chị bình tĩnh",
            "Mẹ ơi, bao giờ bố",
            "Mẹ không ăn à?",
            "Tuần sau trường con",
            "Mẹ thấy con có đẹp",
            "Mẹ! Con đỗ rồi!",
            "Mấy năm nữa con học xong",
            "Sau này con sẽ mua cho mẹ",
            "Mẹ ơi",
            "Mẹ lên đây làm gì",
            "Mẹ về quê đi",
            "Mẹ đừng làm con mất mặt"
        ]
        for p in direct_son_phrases:
            if p.lower() in text.lower():
                child_mismatches.append((cid, chap, role, "ke_phan_dien_nam (Con trai / Nam phụ)", text))
                break

    # Check 3: Con dâu (female antagonist) speaking lines attributed to nhan_vat_chinh
    if role == "nhan_vat_chinh":
        direct_dil_phrases = [
            "Bà Lành", "nhà này không phải cái chợ", "đồ nhà quê", "gầm cầu thang", 
            "vứt hết đi", "mẹ chồng", "ai cho bà", "bà cút đi", "người giúp việc"
        ]
        for p in direct_dil_phrases:
            # Check if it looks like direct speech from con dâu
            if p.lower() in text.lower() and any(re.search(rf"\b{re.escape(verb)}\b", text, re.IGNORECASE) for verb in ["hét lên", "quát", "lườm", "đồ", "bảo bà", "đuổi"]):
                daughter_in_law_mismatches.append((cid, chap, role, "ke_phan_dien_nu (Con dâu)", text))
                break

print(f"\n2. CRITICAL ATTRIBUTION ERRORS DETECTED:")
print(f"  - [LỖI 1] Lời dẫn chuyện Bác Sâm bị đọc nhầm bởi vai khác: {len(narrator_mismatches)} chunks")
for m in narrator_mismatches:
    print(f"    • Chunk {m[0]} (Ch.{m[1]}): Đang gán [{m[2]}] (Giọng Trúc Ly / Mẹ) đọc lời dẫn Bác Sâm: \"{m[4][:80]}...\"")

print(f"\n  - [LỖI 2] Lời thoại Con trai / Nhân vật khác bị gán cho [nhan_vat_chinh] (Mẹ già đọc hộ): {len(child_mismatches)} chunks")
for m in child_mismatches:
    print(f"    • Chunk {m[0]} (Ch.{m[1]}): [{m[2]}] đang đọc thoại của [{m[3]}]: \"{m[4]}\"")

print(f"\n  - [LỖI 3] Lời mắng chửi của Con dâu bị gán cho [nhan_vat_chinh] (Mẹ già tự đọc lời chửi chính mình): {len(daughter_in_law_mismatches)} chunks")
for m in daughter_in_law_mismatches:
    print(f"    • Chunk {m[0]} (Ch.{m[1]}): [{m[2]}] đang đọc lời của [{m[3]}]: \"{m[4]}\"")

# Let's inspect raw script tags
raw_lines = script_path.read_text(encoding="utf-8").splitlines()
tag_counts = {}
for line in raw_lines:
    m = re.match(r"^\[SPEAKER:([a-z0-9_]+)\]", line.strip())
    if m:
        t = m.group(1)
        tag_counts[t] = tag_counts.get(t, 0) + 1

print("\n3. PHÂN TÍCH NGUYÊN NHÂN GỐC:")
print(f"  - Số lượng tag gốc trong file kịch bản full_story_script.md:")
for t, cnt in tag_counts.items():
    print(f"    • [SPEAKER:{t}]: {cnt:3d} dòng")

# Find turns in script
print("\n4. PHÂN TÍCH DỮ LIỆU CÁC CHƯƠNG TRONG KỊCH BẢN:")
chapters_found = set()
for c in chunks:
    chapters_found.add(c.get("chapter"))
print(f"  - Các chương có trong manifest: {sorted(list(chapters_found))}")
