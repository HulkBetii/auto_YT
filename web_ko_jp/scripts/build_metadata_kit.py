"""
build_metadata_kit.py
=====================
Reads video data from DB + output folder, generates youtube_upload_kit.txt
with a PASS / WARN / FAIL pre-publish gate — giống recap_comics `youtube_upload_kit.txt`.

Usage:
    uv run python web_ko_jp/scripts/build_metadata_kit.py --video_id 4
    uv run python web_ko_jp/scripts/build_metadata_kit.py --video_id 4 --dry-run
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from channel_registry import DEFAULT_REGISTRY_PATH, ChannelRegistry
from metadata_gate import GateReport, render_gate_banner, run_gate
from timestamp_sync import extract_raw_chapter_lines

OUTPUT_BASE = REPO_ROOT / "web_ko_jp" / "output"


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
                       audio_path, audio_duration, status,
                       final_script_jp, transcript_text
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

def find_output_folder(video_id: int, output_base: Path = OUTPUT_BASE) -> Optional[Path]:
    """Find v{id}_* folder in output directory."""
    if not output_base.is_dir():
        return None
    for folder in output_base.iterdir():
        if folder.is_dir() and folder.name.startswith(f"v{video_id}_"):
            return folder
    return None


def load_data_json(folder: Path) -> dict:
    """Load data_v*.json from output folder."""
    for f in folder.glob("data_v*.json"):
        try:
            with open(f, encoding="utf-8") as fp:
                return json.load(fp)
        except (OSError, json.JSONDecodeError) as err:
            print(f"[WARN] Unreadable {f.name}: {err}")
    return {}


# ---------------------------------------------------------------------------
# Kit builder
# ---------------------------------------------------------------------------

def load_voice_qa(folder: Optional[Path]) -> Optional[dict]:
    """voice_qa_v*.json written by run_pipeline stage 6b (None when the check never ran)."""
    for f in (folder.glob("voice_qa_v*.json") if folder else []):
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as err:
            print(f"[WARN] Unreadable {f.name}: {err}")
    return None


def collect_kit_inputs(record: dict, data: dict, folder: Optional[Path]) -> dict:
    """Single view of the kit fields: data.json first, DB as fallback. Chapters always come from
    the description, the text that is actually pasted into YouTube."""
    description_jp = data.get("description_jp") or record.get("description_jp") or ""
    duration = record.get("audio_duration") or data.get("audio_duration_seconds")
    return {
        "title_a": data.get("title_a_jp") or record.get("title_jp") or "",
        "title_b": data.get("title_b_jp") or "",
        "title_c": data.get("title_c_jp") or "",
        "description_jp": description_jp,
        "chapter_lines": extract_raw_chapter_lines(description_jp),
        "chapter_sync": data.get("chapter_sync"),
        "tags_flat": data.get("youtube_tags") or data.get("tags_flat") or "",
        "tags_tiered": data.get("tags_tiered") or {},
        "pinned_comment": data.get("pinned_comment") or "",
        "thumbnail_text": data.get("thumbnail_text") or record.get("thumbnail_text") or "",
        "script_jp": data.get("final_script_jp") or record.get("final_script_jp") or "",
        "transcript": record.get("transcript_text") or "",
        "duration": float(duration) if duration else None,
        "srt_exists": bool(folder and any(folder.glob("sub_*.srt"))),
        "voice_qa": load_voice_qa(folder),
    }


def build_gate(
    inputs: dict, registry: ChannelRegistry, video_id: int, stored_title: str = ""
) -> GateReport:
    return run_gate(
        title=inputs["title_a"],
        description=inputs["description_jp"],
        chapter_lines=inputs["chapter_lines"],
        script_jp=inputs["script_jp"],
        transcript=inputs["transcript"],
        registry_titles=registry.titles_for_dedup(exclude_db_video_id=video_id, own_titles=[stored_title]),
        chapter_sync=inputs["chapter_sync"],
        duration_sec=inputs["duration"],
        tags_flat=inputs["tags_flat"],
        thumbnail_text=inputs["thumbnail_text"],
        pinned_comment=inputs["pinned_comment"],
        srt_exists=inputs["srt_exists"],
        voice_qa=inputs.get("voice_qa"),
    )


def build_kit_content(video_id: int, record: dict, inputs: dict, gate: GateReport) -> str:
    """Assemble the youtube_upload_kit.txt content (gate verdict first)."""
    sep = "=" * 80
    duration = inputs["duration"]

    lines = [
        sep,
        *render_gate_banner(gate),
        sep,
        f"YOUTUBE UPLOAD KIT: v{video_id} — {inputs['title_a']}",
        f"Source: {record.get('source_url', '')}",
        f"Audio Duration: {f'{duration:.1f}s ({duration/60:.1f}min)' if duration else 'N/A'}",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        sep,
        "",
        "[1. TITLE — A/B/C TEST OPTIONS]",
        "A is the validated primary title. Paste all 3 into YouTube Studio → Test & Compare.",
        f"★ A: {inputs['title_a']}",
        f"★ B: {inputs['title_b'] or '(not generated)'}",
        f"★ C: {inputs['title_c'] or '(not generated)'}",
        "",
        "[2. DESCRIPTION (Copy & paste into YouTube Description)]",
        inputs["description_jp"],
        "",
        "[3. TAGS — ALL TIERS MERGED (Copy & paste into YouTube Studio Tag Box)]",
    ]

    tags_tiered = inputs["tags_tiered"]
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
    lines.append(f"→ PASTE THIS: {inputs['tags_flat']}")

    lines += [
        "",
        "[4. PINNED COMMENT (Copy & paste to Pin after publish)]",
        inputs["pinned_comment"] or "(not generated — add manually)",
        "",
        "[5. THUMBNAIL TEXT]",
        inputs["thumbnail_text"] or "(not generated)",
        "",
        "[6. CHAPTERS / TIMESTAMPS (already inside the description)]",
    ]
    lines += [f"  {ch}" for ch in inputs["chapter_lines"]] or ["  (no chapters found in description)"]

    voice_qa = inputs.get("voice_qa")
    lines += ["", "[7. VOICE QA — RE-LISTEN BEFORE UPLOAD]"]
    if voice_qa is None:
        lines.append("  (voice QA not run)")
    else:
        lines.append(
            f"  Reading match {voice_qa['reading_match']:.0%} · sentence onsets {voice_qa['onset_match']:.0%}"
            f" · {len(voice_qa['flagged'])} flagged"
        )
        for f in voice_qa["flagged"]:
            lines.append(f"  {int(f['time'] // 60):02d}:{int(f['time'] % 60):02d}  {f['sentence']}")

    lines += ["", sep, "[8. PRE-PUBLISH GATE — ALL CHECKS]", sep]
    for check in gate.checks:
        icon = "✅" if check.passed else ("❌" if check.severity == "fail" else "⚠")
        lines.append(f"  {icon} {check.id}" + (f": {check.detail}" if check.detail else ""))
    lines += ["", f"  OVERALL: {gate.status}", sep]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Build YouTube Upload Kit for a video")
    parser.add_argument("--video_id", type=int, required=True, help="DB video ID")
    parser.add_argument("--dry-run", action="store_true", help="Print to stdout, do not write files or registry")
    parser.add_argument("--output-base", type=Path, default=OUTPUT_BASE, help="Folder holding v{id}_* outputs")
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY_PATH)
    args = parser.parse_args()

    print(f"[build_metadata_kit] Fetching video ID {args.video_id} from DB...")
    record = fetch_video_record(args.video_id)
    print(f"  Found: {record.get('title_jp', 'N/A')} | status={record.get('status')}")

    output_folder = find_output_folder(args.video_id, args.output_base)
    if not output_folder:
        print(f"[WARN] No output folder found for v{args.video_id}_* — creating kit from DB only.")
        data = {}
    else:
        print(f"  Output folder: {output_folder}")
        data = load_data_json(output_folder)

    registry = ChannelRegistry.load(args.registry)
    inputs = collect_kit_inputs(record, data, output_folder)
    gate = build_gate(inputs, registry, args.video_id, stored_title=record.get("title_jp") or "")
    kit_content = build_kit_content(args.video_id, record, inputs, gate)

    if args.dry_run:
        print("\n" + "=" * 80)
        print(kit_content)
        return

    kit_dir = output_folder or args.output_base
    kit_path = kit_dir / f"youtube_upload_kit_v{args.video_id}.txt"
    kit_path.write_text(kit_content, encoding="utf-8")
    print(f"\n[build_metadata_kit] ✅ Written: {kit_path}")
    print("\n".join(render_gate_banner(gate)))

    # Only titles that passed the gate become part of the channel's dedup memory.
    if gate.status != "FAIL":
        registry.record_kit(
            inputs["title_a"], inputs["chapter_lines"], args.video_id,
            source_video_id=record.get("source_video_id") or "",
        )
        registry.save()
        print(f"  Registry updated: {args.registry}")


if __name__ == "__main__":
    main()
