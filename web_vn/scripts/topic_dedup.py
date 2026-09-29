# -*- coding: utf-8 -*-
"""
Topic Deduplication Engine for Vietnamese Audio Drama Pipeline
Chống lặp topic theo 2 lớp:
  Layer 1 (Hard Block):  Hash exact combo archetype+oppression+secret → block nếu đã tồn tại
  Layer 2 (Soft Warn):   N-gram overlap với title/plot_summary đã có → warn nếu > threshold

Registry file: web_vn/data/topic_registry.json
"""

import hashlib
import json
import sys
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = REPO_ROOT / "web_vn" / "data" / "topic_registry.json"

# Similarity threshold: nếu overlap > SOFT_THRESHOLD → cảnh báo, không block
SOFT_THRESHOLD = 0.60
# Số từ ngắn nhất để tính n-gram (bỏ qua từ dừng ngắn)
NGRAM_MIN_LEN = 4


# ---------------------------------------------------------------------------
# Registry I/O
# ---------------------------------------------------------------------------

def _load_registry() -> dict:
    if REGISTRY_PATH.exists():
        try:
            return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"topics": []}


def _save_registry(registry: dict) -> None:
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY_PATH.write_text(
        json.dumps(registry, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


# ---------------------------------------------------------------------------
# Layer 1: Exact-combo Hash
# ---------------------------------------------------------------------------

def _combo_hash(seed: dict) -> str:
    """SHA-256 of the canonical tuple (archetype_id, oppression, plot_secret)."""
    archetype = seed.get("archetype", "")
    if isinstance(archetype, dict):
        archetype_key = archetype.get("id") or archetype.get("title", "")
    else:
        archetype_key = str(archetype)
    raw = "|".join([
        archetype_key.strip().lower(),
        str(seed.get("oppression", "")).strip().lower(),
        str(seed.get("plot_secret", "")).strip().lower(),
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def is_exact_duplicate(seed: dict, registry: Optional[dict] = None) -> Optional[str]:
    """
    Returns story_id of the conflicting entry if exact duplicate found, else None.
    """
    registry = registry or _load_registry()
    h = _combo_hash(seed)
    for entry in registry["topics"]:
        if entry.get("combo_hash") == h:
            return entry.get("story_id", "unknown")
    return None


# ---------------------------------------------------------------------------
# Layer 2: N-gram Soft Similarity
# ---------------------------------------------------------------------------

def _tokenize(text: str) -> set:
    """Extract meaningful word tokens (length >= NGRAM_MIN_LEN)."""
    tokens = re.findall(r'\w+', text.lower())
    return {t for t in tokens if len(t) >= NGRAM_MIN_LEN}


def _jaccard(set_a: set, set_b: set) -> float:
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)


def find_similar_topics(seed: dict, registry: Optional[dict] = None, threshold: float = SOFT_THRESHOLD) -> list[dict]:
    """
    Returns list of registry entries whose title/plot_summary overlap > threshold.
    Each entry has keys: story_id, similarity, title.
    """
    registry = registry or _load_registry()
    candidate_text = " ".join([
        str(seed.get("title", "")),
        str(seed.get("plot_summary", "")),
        str(seed.get("sacrifice", "")),
        str(seed.get("oppression", "")),
    ])
    candidate_tokens = _tokenize(candidate_text)

    similar = []
    for entry in registry["topics"]:
        stored_text = " ".join([
            entry.get("title", ""),
            entry.get("plot_summary", ""),
            entry.get("sacrifice", ""),
            entry.get("oppression", ""),
        ])
        stored_tokens = _tokenize(stored_text)
        sim = _jaccard(candidate_tokens, stored_tokens)
        if sim >= threshold:
            similar.append({
                "story_id": entry.get("story_id", "unknown"),
                "similarity": round(sim, 3),
                "title": entry.get("title", ""),
            })

    similar.sort(key=lambda x: x["similarity"], reverse=True)
    return similar


# ---------------------------------------------------------------------------
# Main public API
# ---------------------------------------------------------------------------

class TopicDedupResult:
    def __init__(self, ok: bool, level: str, message: str, conflicts: list):
        self.ok = ok           # True nếu topic OK để dùng
        self.level = level     # "ok" | "warn" | "block"
        self.message = message
        self.conflicts = conflicts  # list of conflicting entries

    def __repr__(self):
        return f"TopicDedupResult(ok={self.ok}, level={self.level!r}, conflicts={len(self.conflicts)})"


def check_topic(seed: dict) -> TopicDedupResult:
    """
    Full dedup check. Call before using a seed.
    Returns TopicDedupResult:
      - level="block": exact duplicate → do NOT use
      - level="warn":  soft similar → use with caution / regenerate preferred
      - level="ok":    clean → safe to use
    """
    registry = _load_registry()

    # Layer 1: exact hash
    duplicate_id = is_exact_duplicate(seed, registry)
    if duplicate_id:
        return TopicDedupResult(
            ok=False,
            level="block",
            message=f"[BLOCK] Exact duplicate combo found in story '{duplicate_id}'. "
                    "Regenerate với archetype/oppression/secret khác.",
            conflicts=[{"story_id": duplicate_id, "similarity": 1.0}]
        )

    # Layer 2: soft similarity
    similar = find_similar_topics(seed, registry)
    if similar:
        top = similar[0]
        return TopicDedupResult(
            ok=True,
            level="warn",
            message=f"[WARN] Topic tương tự {top['similarity']*100:.0f}% với story '{top['story_id']}'. "
                    "Cân nhắc thay đổi một vài elements để tạo sự mới mẻ.",
            conflicts=similar
        )

    return TopicDedupResult(ok=True, level="ok", message="[OK] Topic sạch, chưa từng dùng.", conflicts=[])


def register_topic(seed: dict, story_id: str) -> None:
    """
    Ghi topic vào registry sau khi đã approved.
    Gọi sau khi story_id được tạo ra và seed đã pass check_topic().
    """
    registry = _load_registry()

    # Tránh đăng ký trùng story_id
    existing_ids = {e.get("story_id") for e in registry["topics"]}
    if story_id in existing_ids:
        print(f"[registry] story_id '{story_id}' already registered. Skip.")
        return

    arch = seed.get("archetype", "")
    entry = {
        "story_id": story_id,
        "combo_hash": _combo_hash(seed),
        "title": str(seed.get("title", "")),
        "archetype": (arch.get("title", "") if isinstance(arch, dict) else str(arch)),
        "sacrifice": str(seed.get("sacrifice", "")),
        "oppression": str(seed.get("oppression", "")),
        "plot_secret": str(seed.get("plot_secret", "")),
        "plot_summary": str(seed.get("plot_summary", "")),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    registry["topics"].append(entry)
    _save_registry(registry)
    print(f"[registry] Registered topic for story '{story_id}' (hash={entry['combo_hash']}).")


def backfill_from_outputs(output_dir: Optional[Path] = None) -> int:
    """
    Quét thư mục output/, đọc tất cả topic_seed.json còn chưa có trong registry.
    Hữu ích khi khởi tạo registry từ đầu từ các story đã có sẵn.
    Returns: số lượng story được backfill.
    """
    output_dir = output_dir or (REPO_ROOT / "web_vn" / "output")
    count = 0
    for seed_file in sorted(output_dir.glob("*/topic_seed.json")):
        try:
            seed = json.loads(seed_file.read_text(encoding="utf-8"))
            story_id = seed.get("story_id") or seed_file.parent.name
            registry = _load_registry()
            if story_id not in {e.get("story_id") for e in registry["topics"]}:
                register_topic(seed, story_id)
                count += 1
        except Exception as e:
            print(f"[backfill] Skip {seed_file}: {e}")
    return count


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Topic Dedup Engine CLI")
    sub = parser.add_subparsers(dest="cmd")

    # backfill: quét output/ và đăng ký tất cả story có sẵn
    sub.add_parser("backfill", help="Scan output/ and register all existing topic_seed.json into registry")

    # list: show registry
    sub.add_parser("list", help="List all registered topics")

    # check: kiểm tra một seed file
    p_check = sub.add_parser("check", help="Check a topic_seed.json file for duplicates")
    p_check.add_argument("seed_file", help="Path to topic_seed.json")

    args = parser.parse_args()

    if args.cmd == "backfill":
        n = backfill_from_outputs()
        print(f"\nBackfill complete: {n} new stories registered.")

    elif args.cmd == "list":
        reg = _load_registry()
        topics = reg.get("topics", [])
        print(f"Registry: {len(topics)} topics registered.")
        for t in topics:
            print(f"  [{t.get('created_at','?')[:10]}] {t['story_id']} | hash={t.get('combo_hash','?')} | {t.get('title','')[:60]}...")

    elif args.cmd == "check":
        seed = json.loads(Path(args.seed_file).read_text(encoding="utf-8"))
        result = check_topic(seed)
        print(result.message)
        if result.conflicts:
            print("Conflicts:")
            for c in result.conflicts:
                print(f"  - {c['story_id']} ({c['similarity']*100:.0f}% similar)")
    else:
        parser.print_help()
