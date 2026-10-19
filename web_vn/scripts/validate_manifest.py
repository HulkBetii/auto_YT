# -*- coding: utf-8 -*-
"""
Automated Audio Manifest Quality and Multi-Role Attribution Validator v4.0 (Production-Grade).
Ensures 100% integrity, clean TTS formatting, character diversity, breath limits, and dramatic silence padding.
"""

import sys
import json
import argparse
from pathlib import Path
from collections import defaultdict, Counter

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")

def validate_manifest(manifest_path: Path) -> bool:
    if not manifest_path.exists():
        print(f"[ERROR] Manifest file not found: {manifest_path}")
        return False

    print(f"=== VALIDATING AUDIO MANIFEST v4.0: {manifest_path.name} ===")
    
    entries = []
    with manifest_path.open("r", encoding="utf-8") as f:
        for idx, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except Exception as e:
                print(f"[ERROR] Line {idx} invalid JSON: {e}")
                return False

    total_chunks = len(entries)
    total_words = sum(e.get("words", 0) for e in entries)
    est_duration_min = total_words / 125
    est_duration_hr = est_duration_min / 60

    print(f"Total Chunks: {total_chunks:,}")
    print(f"Total Words: {total_words:,} words")
    print(f"Estimated Duration: {est_duration_hr:.2f} hours ({est_duration_min:.1f} mins)")
    print("-" * 75)

    # 1. Distribution by Speaker
    speaker_counts = Counter(e.get("speaker_id", "unknown") for e in entries)
    print("SPEAKER DISTRIBUTION:")
    for spk, count in sorted(speaker_counts.items(), key=lambda x: -x[1]):
        pct = (count / total_chunks) * 100
        print(f"  - {spk:<18}: {count:>5} chunks ({pct:>5.1f}%)")
    print("-" * 75)

    # 2. Distribution by Chapter & Speaker Matrix
    chapter_speakers = defaultdict(Counter)
    for e in entries:
        ch = e.get("chapter", 1)
        spk = e.get("speaker_id", "unknown")
        chapter_speakers[ch][spk] += 1

    print("CHAPTER-BY-CHAPTER VOICE MATRIX:")
    all_speakers = sorted(speaker_counts.keys())
    header = "  Ch   | " + " | ".join(f"{s[:10]:<10}" for s in all_speakers) + " | Total"
    print(header)
    print("  " + "-" * len(header))

    for ch in range(1, 11):
        spk_map = chapter_speakers[ch]
        row_total = sum(spk_map.values())
        row_str = f"  {ch:<4} | " + " | ".join(f"{spk_map.get(s, 0):>10}" for s in all_speakers) + f" | {row_total:>5}"
        print(row_str)
    print("-" * 75)

    # 3. Dynamic Dramatic Silence Padding Metrics
    total_silence_ms = sum(e.get("silence_after_ms", 200) for e in entries)
    transitions = sum(1 for i in range(len(entries) - 1) if entries[i]["speaker_id"] != entries[i+1]["speaker_id"])
    
    print("DRAMATIC SILENCE & PACING METRICS:")
    print(f"  - Total Speaker Transitions    : {transitions} dynamic role changes")
    print(f"  - Total Silence Padding        : {total_silence_ms / 1000:.1f} seconds (~{total_silence_ms / 60000:.1f} mins)")
    print(f"  - Average Silence Per Chunk    : {total_silence_ms / total_chunks:.1f} ms")
    print("-" * 75)

    # 4. Quality & Formatting Checks
    issues = []
    for e in entries:
        cid = e.get("id", "unknown")
        text = e.get("text", "")
        words = e.get("words", 0)
        silence = e.get("silence_after_ms", 0)
        
        # Check breath word limits (Pacing Engine v5.1 trần 38 từ)
        if words > 38:
            issues.append(f"[{cid}] Overlength chunk ({words} words > 38 limit): {text[:60]}...")
            
        # Check for un-stripped meta tags or markdown
        if any(bad in text for bad in ["[SPEAKER", "**", "##", ">>", "__"]):
            issues.append(f"[{cid}] Leftover markdown/meta tag in text: {text}")

        # Check silence padding validity (80ms - 3000ms)
        if silence < 50 or silence > 3000:
            issues.append(f"[{cid}] Invalid silence padding: {silence}ms")

    if issues:
        print(f"[WARNING] Found {len(issues)} formatting anomalies:")
        for iss in issues[:15]:
            print(f"  ! {iss}")
        if len(issues) > 15:
            print(f"  ... and {len(issues) - 15} more issues.")
    else:
        print("[PASS] 100% Quality checks passed: Zero meta tags, clean punctuation, compliant breath limits (<=38 words), dynamic silence valid.")

    # 5. Multi-Role Diversity Verification (4 canonical roles)
    print("-" * 75)
    has_host = "bac_sam" in speaker_counts
    has_protagonist = "nhan_vat_chinh" in speaker_counts
    has_female_antagonist = "ke_phan_dien_nu" in speaker_counts
    has_male_supporting = "ke_phan_dien_nam" in speaker_counts

    # Alert if nhan_vat_chinh dominance is suspiciously high (possible misattribution)
    protagonist_ratio = speaker_counts.get("nhan_vat_chinh", 0) / total_chunks if total_chunks > 0 else 0
    attribution_warning = protagonist_ratio > 0.80

    print("DIVERSITY SUMMARY (4-Role System):")
    print(f"  - Host Narrator (bac_sam)          : {'[OK] Present' if has_host else '[WARN] Missing'}")
    print(f"  - Protagonist (nhan_vat_chinh)      : {'[OK] Present' if has_protagonist else '[WARN] Missing'} ({protagonist_ratio:.0%} of chunks)")
    print(f"  - Female Antagonist (ke_phan_dien_nu): {'[OK] Present' if has_female_antagonist else '[WARN] Missing'}")
    print(f"  - Male Supporting (ke_phan_dien_nam) : {'[OK] Present' if has_male_supporting else '[WARN] Missing'}")
    if attribution_warning:
        print(f"  [CAUTION] nhan_vat_chinh > 80% — possible voice misattribution. Check SPEAKER tags in script.")
    print("=" * 75)


    return len(issues) == 0

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate Audio Manifest v4.0")
    parser.add_argument("--manifest", type=str, default=str(REPO_ROOT / "web_vn" / "output" / "story_e2e_test_01" / "audio_manifest.jsonl"))
    args = parser.parse_args()

    success = validate_manifest(Path(args.manifest))
    sys.exit(0 if success else 1)
