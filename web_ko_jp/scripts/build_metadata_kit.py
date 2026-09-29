"""
build_metadata_kit.py
=====================
Reads video data from DB + output folder, generates youtube_upload_kit.txt
with compliance audit — giống recap_comics `youtube_upload_kit.txt`.

Usage:
    uv run python web_ko_jp/scripts/build_metadata_kit.py --video_id 4
    uv run python web_ko_jp/scripts/build_metadata_kit.py --video_id 4 --dry-run
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

OUTPUT_BASE = REPO_ROOT / "web_ko_jp" / "output"

# Fixed 3 hashtags — do not change
FIXED_HASHTAGS = "#人間関係 #人生哲学 #先人の知恵"

# Compliance thresholds
TITLE_MAX_CHARS = 55          # ideal max; YouTube allows 100
DESC_MAX_BYTES = 5000
TAGS_MAX_CHARS = 500
HASHTAG_EXACT = 3


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def get_db_connection():
    """Connect to auto_yt_ko_jp Postgres via Docker port 5437."""
    try:
        import psycopg2
        return psycopg2.connect(
            host="localhost",
            port=5437,
            database="auto_yt_ko_jp",
            user="postgres",
            password="postgres",
        )
    except ImportError:
        raise RuntimeError("psycopg2 not installed. Run: uv add psycopg2-binary")


def fetch_video_record(video_id: int) -> dict:
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, source_url, source_video_id, source_title,
                       title_jp, description_jp, thumbnail_text,
                       audio_path, audio_duration, status
                FROM ko_jp_videos WHERE id = %s
                """,
                (video_id,),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError(f"Video ID {video_id} not found in DB.")
            cols = [d[0] for d in cur.description]
            return dict(zip(cols, row))
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Output folder discovery
# ---------------------------------------------------------------------------

def find_output_folder(video_id: int) -> Path | None:
    """Find v{id}_* folder in output directory."""
    for folder in OUTPUT_BASE.iterdir():
        if folder.is_dir() and folder.name.startswith(f"v{video_id}_"):
            return folder
    return None


def load_data_json(folder: Path) -> dict:
    """Load data_v*.json from output folder."""
    for f in folder.glob("data_v*.json"):
        try:
            with open(f, encoding="utf-8") as fp:
                return json.load(fp)
        except Exception:
            pass
    return {}


# ---------------------------------------------------------------------------
# Compliance audit
# ---------------------------------------------------------------------------

def run_compliance_audit(
    title_primary: str,
    description_jp: str,
    tags_flat: str,
    chapters_raw: list,
    pinned_comment: str,
) -> dict:
    """Run pre-publish compliance checks. Returns audit dict."""
    title_chars = len(title_primary)
    desc_bytes = len(description_jp.encode("utf-8"))
    tags_chars = len(tags_flat.encode("utf-8"))

    # Count hashtags in description
    hashtags_in_desc = re.findall(r"#\S+", description_jp)
    hashtag_count = len(hashtags_in_desc)

    # Check first chapter is 00:00
    first_chapter_ok = bool(chapters_raw and re.match(r"^00:00", chapters_raw[0].strip()))

    # YPP originality: check for AI disclaimer
    ypp_ok = any(
        phrase in description_jp
        for phrase in ["合成音声", "AI音声", "脚本・構成", "オリジナル", "独自のもの"]
    )

    # Check placeholder timestamps still present
    has_placeholder = "XX:XX" in description_jp

    audit = {
        "title_chars": title_chars,
        "title_chars_ok": title_chars <= TITLE_MAX_CHARS,
        "description_bytes": desc_bytes,
        "description_bytes_ok": desc_bytes <= DESC_MAX_BYTES,
        "tags_chars": tags_chars,
        "tags_chars_ok": tags_chars <= TAGS_MAX_CHARS,
        "hashtag_count": hashtag_count,
        "hashtag_count_ok": hashtag_count == HASHTAG_EXACT,
        "first_chapter_is_zero": first_chapter_ok,
        "ypp_originality_statement": ypp_ok,
        "timestamps_placeholder_present": has_placeholder,
        "pinned_comment_present": bool(pinned_comment.strip()),
    }

    audit["overall_pass"] = all([
        audit["title_chars_ok"],
        audit["description_bytes_ok"],
        audit["tags_chars_ok"],
        audit["hashtag_count_ok"],
        audit["first_chapter_is_zero"],
        audit["ypp_originality_statement"],
    ])

    return audit


# ---------------------------------------------------------------------------
# Kit builder
# ---------------------------------------------------------------------------

def build_kit_content(video_id: int, record: dict, data: dict, audit: dict) -> str:
    """Assemble the youtube_upload_kit.txt content."""
    sep = "=" * 80

    # Title variants — prefer data.json, fallback to DB
    title_a = data.get("title_a_jp") or record.get("title_jp", "")
    title_b = data.get("title_b_jp") or ""
    title_c = data.get("title_c_jp") or ""
    title_primary = title_a or record.get("title_jp", "")

    description_jp = data.get("description_jp") or record.get("description_jp", "")
    tags_flat = data.get("youtube_tags") or data.get("tags_flat") or ""
    tags_tiered = data.get("tags_tiered") or {}
    pinned_comment = data.get("pinned_comment") or ""
    chapters_raw = data.get("chapters_raw") or []
    audio_duration = record.get("audio_duration")
    source_url = record.get("source_url", "")

    folder_name = f"v{video_id}_{record.get('source_video_id', '')}_{record.get('source_title', '')[:30].replace(' ', '_')}"

    lines = [
        sep,
        f"YOUTUBE UPLOAD KIT: v{video_id} — {title_primary}",
        f"Source: {source_url}",
        f"Audio Duration: {f'{audio_duration:.1f}s ({audio_duration/60:.1f}min)' if audio_duration else 'N/A'}",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        sep,
        "",
        "[1. TITLE — A/B/C TEST OPTIONS]",
        "Paste all 3 into YouTube Studio → A/B Test Title feature.",
        f"★ Hypothesis A (Warning/Conflict Hook):",
        f"  {title_a}",
        f"★ Hypothesis B (Paradox/Reverse Expectation):",
        f"  {title_b or '(not generated)'}",
        f"★ Hypothesis C (Age-Specific/Life-Stage):",
        f"  {title_c or '(not generated)'}",
        "",
        "[2. DESCRIPTION (Copy & paste into YouTube Description)]",
        description_jp,
        "",
        "[3. TAGS — ALL TIERS MERGED (Copy & paste into YouTube Studio Tag Box)]",
    ]

    if tags_tiered:
        lines.append("--- Tiered breakdown ---")
        for tier, label in [
            ("tier1", "TIER 1 Core Anchors"),
            ("tier2", "TIER 2 Topic-Specific"),
            ("tier3", "TIER 3 Long-tail"),
            ("tier4", "TIER 4 Demographic"),
        ]:
            t = tags_tiered.get(tier, [])
            if t:
                lines.append(f"  {label}: {', '.join(t)}")
        lines.append("")
    lines.append(f"→ PASTE THIS: {tags_flat}")

    lines += [
        "",
        f"[4. PINNED COMMENT (Copy & paste to Pin after publish)]",
        pinned_comment if pinned_comment else "(not generated — add manually)",
        "",
        "[5. CHAPTERS / TIMESTAMPS (for video description)]",
    ]
    if chapters_raw:
        for ch in chapters_raw:
            lines.append(f"  {ch}")
        if any("XX:XX" in ch for ch in chapters_raw):
            lines.append("  ⚠ Replace XX:XX with actual timestamps before upload.")
    else:
        lines.append("  (no chapters extracted)")

    # Compliance audit section
    lines += [
        "",
        sep,
        "[6. PRE-PUBLISH COMPLIANCE AUDIT]",
        sep,
    ]

    def audit_line(label, value, ok_key):
        status = "✅ PASS" if audit.get(ok_key) else "❌ FAIL"
        return f"  {status}  {label}: {value}"

    lines += [
        audit_line(f"Title Length", f"{audit['title_chars']} chars (target ≤{TITLE_MAX_CHARS})", "title_chars_ok"),
        audit_line(f"Description Size", f"{audit['description_bytes']} bytes (target ≤{DESC_MAX_BYTES})", "description_bytes_ok"),
        audit_line(f"Tags Total", f"{audit['tags_chars']} chars (target ≤{TAGS_MAX_CHARS})", "tags_chars_ok"),
        audit_line(f"Hashtag Count", f"{audit['hashtag_count']} (target = {HASHTAG_EXACT})", "hashtag_count_ok"),
        audit_line(f"First Chapter = 00:00", str(audit['first_chapter_is_zero']), "first_chapter_is_zero"),
        audit_line(f"AI Disclaimer Present", str(audit['ypp_originality_statement']), "ypp_originality_statement"),
        f"  {'⚠ NOTE' if audit['timestamps_placeholder_present'] else '✅ OK  '}  Timestamp Placeholders: {'XX:XX still present — replace before upload' if audit['timestamps_placeholder_present'] else 'All resolved'}",
        f"  {'✅ OK  ' if audit['pinned_comment_present'] else '⚠ NOTE'}  Pinned Comment: {'Ready' if audit['pinned_comment_present'] else 'Not generated'}",
        "",
        f"  OVERALL: {'✅ READY TO UPLOAD' if audit['overall_pass'] else '❌ FIX ISSUES ABOVE BEFORE UPLOADING'}",
        sep,
    ]

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Build YouTube Upload Kit for a video")
    parser.add_argument("--video_id", type=int, required=True, help="DB video ID")
    parser.add_argument("--dry-run", action="store_true", help="Print to stdout, do not write file")
    args = parser.parse_args()

    print(f"[build_metadata_kit] Fetching video ID {args.video_id} from DB...")
    record = fetch_video_record(args.video_id)
    print(f"  Found: {record.get('title_jp', 'N/A')} | status={record.get('status')}")

    output_folder = find_output_folder(args.video_id)
    if not output_folder:
        print(f"[WARN] No output folder found for v{args.video_id}_* — creating kit from DB only.")
        data = {}
    else:
        print(f"  Output folder: {output_folder}")
        data = load_data_json(output_folder)
        print(f"  data.json keys: {list(data.keys())}")

    # Merge description from DB if data.json doesn't have it
    if not data.get("description_jp") and record.get("description_jp"):
        data["description_jp"] = record["description_jp"]
    if not data.get("title_a_jp") and record.get("title_jp"):
        data["title_a_jp"] = record["title_jp"]

    description_jp = data.get("description_jp") or ""
    tags_flat = data.get("youtube_tags") or data.get("tags_flat") or ""
    chapters_raw = data.get("chapters_raw") or []
    pinned_comment = data.get("pinned_comment") or ""
    title_primary = data.get("title_a_jp") or record.get("title_jp", "")

    audit = run_compliance_audit(
        title_primary=title_primary,
        description_jp=description_jp,
        tags_flat=tags_flat,
        chapters_raw=chapters_raw,
        pinned_comment=pinned_comment,
    )

    kit_content = build_kit_content(args.video_id, record, data, audit)

    if args.dry_run:
        print("\n" + "=" * 80)
        print(kit_content)
        return

    # Write to output folder
    if output_folder:
        kit_path = output_folder / f"youtube_upload_kit_v{args.video_id}.txt"
    else:
        kit_path = OUTPUT_BASE / f"youtube_upload_kit_v{args.video_id}.txt"

    kit_path.write_text(kit_content, encoding="utf-8")
    print(f"\n[build_metadata_kit] ✅ Written: {kit_path}")
    print(f"  Audit overall: {'PASS' if audit['overall_pass'] else 'FAIL'}")
    for k, v in audit.items():
        if isinstance(v, bool):
            icon = "✅" if v else "❌"
            print(f"    {icon} {k}: {v}")


if __name__ == "__main__":
    main()
