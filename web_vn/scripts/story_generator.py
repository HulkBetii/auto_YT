# -*- coding: utf-8 -*-
"""
Story Generator Engine for Vietnamese Audio Drama (Sâm Kể Chuyện Style) v4.1
Hierarchical 3-Pass Architecture:
Pass 1: Topic & Master Blueprint (5-Act Structure) loaded dynamically from topic_matrix_presets.json
Pass 2: 10-12 Chapter Decomposition
Pass 3: Rolling Context Chapter Expansion

Features:
- Integrated with topic_matrix_presets.json (multi-cluster support)
- 2-Layer Dedup Engine (hash hard-block + Jaccard soft-warn)
- Realistic Vietnamese character name generation
- Saves topic_seed.json directly to output folder
"""

import json
import random
import re
import os
import sys
import argparse
from pathlib import Path
from typing import Dict, Any, List, Optional

sys.stdout.reconfigure(encoding='utf-8')

REPO_ROOT = Path(__file__).resolve().parents[2]
MATRIX_PRESETS_PATH = REPO_ROOT / "web_vn" / "data" / "topic_matrix_presets.json"
VOICES_FILE = REPO_ROOT / "web_vn" / "data" / "voice_profiles" / "voices.json"
OUTPUT_BASE = REPO_ROOT / "web_vn" / "output"

# Topic deduplication
try:
    sys.path.insert(0, str(Path(__file__).parent))
    from topic_dedup import check_topic, register_topic
    _DEDUP_ENABLED = True
except ImportError:
    _DEDUP_ENABLED = False

MAX_DEDUP_RETRY = 10

# Map preset voice role to canonical voices.json speaker IDs
CANONICAL_VOICE_MAP = {
    "bac_sam": "bac_sam",
    "host": "bac_sam",
    "nhan_vat_chinh": "nhan_vat_chinh",
    "nu_chinh": "nhan_vat_chinh",
    "bo_chong": "bo_chong",
    "cuu_binh": "bo_chong",
    "me_gia": "me_gia",
    "nguoi_chong": "nguoi_chong",
    "me_chong": "me_chong",
    "tieu_tam": "tieu_tam",
    "con_dau_hon": "tieu_tam",
    "con_dau": "tieu_tam",
    "vo_ngoai_tinh": "tieu_tam",
    "chong_boi_bac": "chong_boi_bac",
    "nhan_tinh": "chong_boi_bac",
    "con_trai_nhu_nhuoc": "chong_boi_bac",
    "can_bo": "can_bo",
    "justice": "can_bo",
}

# Name pools for automatic realistic Vietnamese character naming
CHARACTER_NAMES_POOL = {
    "bo_chong": ["Nguyễn Đức Cần", "Trần Văn Thọ", "Lê Đình Phúc", "Phạm Văn Lượng", "Vũ Đình Sâm"],
    "nhan_vat_chinh": ["Nguyễn Minh Hà", "Trần Thu Thảo", "Lê Phương Mai", "Vũ Hoàng Yến", "Phạm Thu Dung"],
    "me_gia": ["Bà Nguyễn Thị Lành", "Bà Trần Thị Mùi", "Bà Lê Thị Hạt", "Bà Phạm Thị Cúc"],
    "nguoi_chong": ["Trần Quốc Tuấn", "Nguyễn Văn Hùng", "Lê Trọng Đạt", "Phạm Quốc Bảo"],
    "me_chong": ["Bà Lý Thị Hoa", "Bà Trần Thị Lanh", "Bà Lê Thị Kim", "Bà Vũ Thị Tuyết"],
    "tieu_tam": ["Trần Thu Trang", "Nguyễn Hải Yến", "Lê Thanh Vy", "Đặng Khánh Ly", "Hoàng Bích Trâm"],
    "con_dau_hon": ["Trần Thu Trang", "Lê Thùy Chi", "Nguyễn Hồng Hạnh", "Vũ Kim Oanh"],
    "vo_ngoai_tinh": ["Trần Kim Dung", "Nguyễn Phương Oanh", "Lê Thúy Hằng"],
    "chong_boi_bac": ["Nguyễn Đức Hưng", "Trần Quang Huy", "Lê Quốc Thái", "Phạm Minh Hoàng"],
    "nhan_tinh": ["Vũ Minh Tuấn", "Hoàng Đăng Khôi", "Lê Văn Tiến", "Trần Bảo Nam"],
    "can_bo": ["Thiếu tướng Trần Tuấn Anh", "Đại tá Nguyễn Việt Thắng", "Trung tá Lê Quang Huy", "Luật sư Phạm Văn Định"],
    "bac_sam": ["Bác Sâm"]
}


def load_topic_matrix() -> dict:
    """Loads topic clusters from topic_matrix_presets.json."""
    if not MATRIX_PRESETS_PATH.exists():
        raise FileNotFoundError(f"Missing matrix presets at {MATRIX_PRESETS_PATH}")
    return json.loads(MATRIX_PRESETS_PATH.read_text(encoding="utf-8"))


def get_available_clusters() -> List[str]:
    matrix = load_topic_matrix()
    return [c["id"] for c in matrix.get("clusters", [])]


def _pick_character_name(role: str, used_names: set) -> str:
    canonical_role = CANONICAL_VOICE_MAP.get(role, role)
    pool = CHARACTER_NAMES_POOL.get(role) or CHARACTER_NAMES_POOL.get(canonical_role) or ["Nhân vật"]
    choices = [n for n in pool if n not in used_names]
    name = random.choice(choices if choices else pool)
    used_names.add(name)
    return name


def _build_raw_seed_from_matrix(cluster_id: Optional[str] = None) -> dict:
    """Generates a complete, structured topic seed using topic_matrix_presets.json."""
    matrix = load_topic_matrix()
    clusters = matrix.get("clusters", [])
    if not clusters:
        raise ValueError("No clusters found in topic_matrix_presets.json")

    # Select cluster
    if cluster_id:
        matched = [c for c in clusters if c["id"] == cluster_id]
        if not matched:
            raise ValueError(f"Cluster '{cluster_id}' not found. Available: {[c['id'] for c in clusters]}")
        cluster = matched[0]
    else:
        cluster = random.choice(clusters)

    arch_obj = random.choice(cluster.get("archetypes", [{"title": "Nhân vật chính", "desc": ""}]))
    archetype_title = arch_obj.get("title", "Nhân vật chính")
    archetype_desc = arch_obj.get("desc", "")

    sac = random.choice(cluster.get("sacrifices", ["Tần tảo hy sinh vì hạnh phúc gia đình"]))
    opp = random.choice(cluster.get("oppressions", ["Bị bạc đãi, chèn ép tàn nhẫn"]))
    sec = random.choice(cluster.get("plot_secrets", ["Thực chất có thân phận và tài sản hợp pháp"]))
    ret = random.choice(cluster.get("retributions", ["Kẻ ác phải đối diện với pháp luật và lương tâm"]))
    mor = random.choice(cluster.get("morals", ["Gieo nhân nào gặt quả ấy"]))

    # Title: choose from templates or synthesize
    templates = cluster.get("title_templates", [])
    if templates:
        title = random.choice(templates)
    else:
        title = f"{archetype_title} Bị Bạc Đãi – Giờ G Kẻ Vong Ân Chết Lặng Khi Thấy Sự Thật | Sâm Kể Chuyện"

    # Voice Preset mapping
    raw_vp = cluster.get("voice_preset", {})
    victim_role_key = CANONICAL_VOICE_MAP.get(raw_vp.get("victim", "nhan_vat_chinh"), "nhan_vat_chinh")
    antagonist_1_key = CANONICAL_VOICE_MAP.get(raw_vp.get("antagonist_1", "me_chong"), "me_chong")
    antagonist_2_key = CANONICAL_VOICE_MAP.get(raw_vp.get("antagonist_2", "chong_boi_bac"), "chong_boi_bac")
    justice_key = CANONICAL_VOICE_MAP.get(raw_vp.get("justice", "can_bo"), "can_bo")

    voice_preset = {
        "host": "bac_sam",
        "victim": victim_role_key,
        "antagonist_1": antagonist_1_key,
        "antagonist_2": antagonist_2_key,
        "justice": justice_key,
    }

    # Generate distinct character names
    used_names = set()
    victim_name = _pick_character_name(raw_vp.get("victim", victim_role_key), used_names)
    antagonist_1_name = _pick_character_name(raw_vp.get("antagonist_1", antagonist_1_key), used_names)
    antagonist_2_name = _pick_character_name(raw_vp.get("antagonist_2", antagonist_2_key), used_names)
    justice_name = _pick_character_name(justice_key, used_names)

    characters = {
        "bac_sam": "Bác Sâm",
        victim_role_key: victim_name,
        antagonist_1_key: antagonist_1_name,
        antagonist_2_key: antagonist_2_name,
        justice_key: justice_name,
    }

    plot_summary = (
        f"{victim_name} ({archetype_title}, {archetype_desc}) một đời hy sinh: {sac}. "
        f"Thế nhưng lại bị {antagonist_1_name} ({cluster.get('antagonist_1_name', 'Kẻ đối kháng 1')}) và "
        f"{antagonist_2_name} ({cluster.get('antagonist_2_name', 'Kẻ đối kháng 2')}) ngược đãi: {opp}. "
        f"Đỉnh điểm, bí mật được hé lộ: {sec}. "
        f"Đúng lúc đó, {justice_name} xuất hiện mang lại công lý: {ret}."
    )

    return {
        "cluster_id": cluster.get("id"),
        "cluster_name": cluster.get("name"),
        "theme": cluster.get("desc", cluster.get("name", "")),
        "title": title,
        "archetype": archetype_title,
        "archetype_desc": archetype_desc,
        "default_pronoun": cluster.get("default_pronoun", "Tôi"),
        "victim_role": victim_role_key,
        "victim_role_name": cluster.get("victim_role_name", archetype_title),
        "antagonist_1_role": antagonist_1_key,
        "antagonist_1_name": cluster.get("antagonist_1_name", "Kẻ đối kháng 1"),
        "antagonist_2_role": antagonist_2_key,
        "antagonist_2_name": cluster.get("antagonist_2_name", "Kẻ đối kháng 2"),
        "justice_role": justice_key,
        "justice_name": cluster.get("justice_name", "Đại diện công lý"),
        "voice_preset": voice_preset,
        "characters": characters,
        "sacrifice": sac,
        "oppression": opp,
        "plot_secret": sec,
        "retribution": ret,
        "moral": mor,
        "plot_summary": plot_summary,
    }


def generate_topic_seed(
    story_id: str = "",
    cluster_id: Optional[str] = None,
    auto_register: bool = False,
    output_dir: Optional[Path] = None,
) -> dict:
    """
    Generates a unique topic seed with multi-cluster support and dedup protection.
    Automatically saves to {output_dir}/topic_seed.json if output_dir is provided or story_id is given.
    """
    last_seed = None
    for attempt in range(1, MAX_DEDUP_RETRY + 1):
        candidate = _build_raw_seed_from_matrix(cluster_id=cluster_id)
        if story_id:
            candidate["story_id"] = story_id

        if not _DEDUP_ENABLED:
            last_seed = candidate
            break

        result = check_topic(candidate)
        if result.level == "block":
            print(f"[dedup] Attempt {attempt}/{MAX_DEDUP_RETRY}: BLOCK — {result.message}")
            last_seed = candidate
            continue

        if result.level == "warn":
            top = result.conflicts[0] if result.conflicts else {}
            print(f"[dedup] Attempt {attempt}/{MAX_DEDUP_RETRY}: WARN — {top.get('similarity', 0)*100:.0f}% similar to '{top.get('story_id', '?')}'. Accepted.")

        last_seed = candidate
        break
    else:
        print(f"[dedup] WARNING: Could not find 100% unique seed after {MAX_DEDUP_RETRY} retries. Using best candidate.")

    if auto_register and story_id and _DEDUP_ENABLED and last_seed:
        register_topic(last_seed, story_id)

    # Save to disk if output destination is known
    target_dir = output_dir or (OUTPUT_BASE / story_id if story_id else None)
    if target_dir and last_seed:
        target_dir.mkdir(parents=True, exist_ok=True)
        seed_path = target_dir / "topic_seed.json"
        seed_path.write_text(json.dumps(last_seed, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[generator] Saved topic seed to: {seed_path}")

    return last_seed


def generate_master_blueprint(topic_seed: dict) -> dict:
    """Creates 5-Act narrative framework matching Sâm Kể Chuyện conventions."""
    victim_name = topic_seed.get("characters", {}).get(topic_seed.get("victim_role", ""), "nhân vật chính")
    pronoun = topic_seed.get("default_pronoun", "Tôi")
    title = topic_seed.get("title", "")
    arch = topic_seed.get("archetype", "Nhân vật chính")

    return {
        "title": title,
        "hook": (
            f"(00:01) [SPEAKER:bac_sam] Đêm nay, bác Sâm xin mời quý vị ngồi lại thật chậm để cùng lắng nghe "
            f"và chiêm nghiệm câu chuyện của {pronoun.lower()} {victim_name}. Một {arch.lower()} đã đi qua bao thăng trầm, "
            f"cả đời gom góp vì tổ ấm gia đình, nhưng lại phải nếm trải nhát dao đau đớn nhất từ chính những kẻ mình hết mực tin yêu..."
        ),
        "act1": f"Hồi 1 - Những năm tháng nghèo khó và sự hy sinh thầm lặng: {topic_seed.get('sacrifice', '')}. Niềm tin trọn vẹn ban đầu.",
        "act2": f"Hồi 2 - Vết nứt âm thầm và lòng dạ đổi thay: Bị ngược đãi, dồn ép tàn nhẫn: {topic_seed.get('oppression', '')}.",
        "act3": f"Hồi 3 - Giọt nước tràn ly và cuộc điều tra ngầm: Phát hiện âm mưu tráo trở: {topic_seed.get('plot_secret', '')}.",
        "act4": f"Hồi 4 - Cao trào đối đầu và Cán cân công lý: {topic_seed.get('retribution', '')}. Lật kèo phơi bày sự thật.",
        "act5": f"Hồi 5 - Hậu vận, Bình yên và Bài học nhân sinh: {topic_seed.get('moral', '')}.",
        "moral_summary": topic_seed.get("moral", ""),
    }


def generate_chapters_outline(blueprint: dict) -> List[dict]:
    """Generates 10 standard dramatic chapter outlines."""
    return [
        {"number": 1, "act": "Hồi 1", "title": "Bát cơm nguội và lời thề ngày nghèo khó", "goal": "Khắc họa nguồn cội, đức hy sinh và tình cảm ban đầu."},
        {"number": 2, "act": "Hồi 1", "title": "Mái nhà xây bằng những nhọc nhằn", "goal": "Giao tài sản, dốc trọn lòng tin cho người thân."},
        {"number": 3, "act": "Hồi 2", "title": "Những cuộc gọi đêm và mật khẩu đổi thay", "goal": "Những dấu hiệu lạnh nhạt và mầm mống phản bội đầu tiên."},
        {"number": 4, "act": "Hồi 2", "title": "Khi kẻ thứ ba bước qua ngưỡng cửa", "goal": "Sự xuất hiện trơ trẽn, mâu thuẫn đẩy lên đỉnh điểm."},
        {"number": 5, "act": "Hồi 3", "title": "Biến cố bất ngờ và lòng người lộ diện", "goal": "Tai nạn hoặc giả vờ cam chịu để nghe lén âm mưu tẩu tán tài sản."},
        {"number": 6, "act": "Hồi 3", "title": "Thu thập từng mảnh chứng cứ trong bóng tối", "goal": "Âm thầm phục hồi giấy tờ, sao kê ngân hàng và chứng cứ."},
        {"number": 7, "act": "Hồi 4", "title": "Bản hợp đồng chuyển nhượng tiền tỷ", "goal": "Cảnh ép ký giấy, nhân vật chính dứt khoát đối chất."},
        {"number": 8, "act": "Hồi 4", "title": "Cầu vai sắc phục và sự chết lặng", "goal": "Lực lượng chức năng ập vào, thân phận thật sự lộ diện."},
        {"number": 9, "act": "Hồi 5", "title": "Cái giá đắt của sự vong ân", "goal": "Kẻ bất hiếu/bội bạc chịu án phạt pháp luật, ăn năn muộn màng."},
        {"number": 10, "act": "Hồi 5", "title": "Bát phở ấm bên đường và ngày trở về", "goal": "Tìm lại sự an yên, đúc kết bài học cùng Bác Sâm."},
    ]


def main():
    parser = argparse.ArgumentParser(description="Story Generator Engine v4.1 (Vietnamese Audio Drama)")
    parser.add_argument("--story-id", type=str, default="", help="Story ID (e.g. story_bo_chong_02)")
    parser.add_argument("--cluster", type=str, default=None, help="Cluster ID from topic_matrix_presets.json")
    parser.add_argument("--output-dir", type=str, default=None, help="Custom output directory")
    parser.add_argument("--auto-register", action="store_true", help="Auto-register topic with topic_dedup")
    parser.add_argument("--save-blueprint", action="store_true", help="Also save master_blueprint.json and chapters_outline.json")
    parser.add_argument("--list-clusters", action="store_true", help="List available topic clusters")

    args = parser.parse_args()

    if args.list_clusters:
        matrix = load_topic_matrix()
        print("AVAILABLE TOPIC CLUSTERS:")
        for c in matrix.get("clusters", []):
            print(f"  - {c['id']:<35} : {c['name']} [{c.get('badge', '')}]")
        return

    out_dir = Path(args.output_dir) if args.output_dir else (OUTPUT_BASE / args.story_id if args.story_id else None)

    seed = generate_topic_seed(
        story_id=args.story_id,
        cluster_id=args.cluster,
        auto_register=args.auto_register,
        output_dir=out_dir
    )

    bp = generate_master_blueprint(seed)
    chaps = generate_chapters_outline(bp)

    print("\n=== TOPIC GENERATED SUCCESSFULLY ===")
    print(f"Story ID    : {seed.get('story_id', '(none)')}")
    print(f"Cluster     : {seed.get('cluster_name', '')} ({seed.get('cluster_id', '')})")
    print(f"Title       : {seed.get('title')}")
    print(f"Victim      : [{seed.get('victim_role')}] {seed.get('characters', {}).get(seed.get('victim_role'), '')}")
    print(f"Characters  : {seed.get('characters')}")
    print(f"Total Chaps : {len(chaps)}")

    if args.save_blueprint and out_dir:
        (out_dir / "master_blueprint.json").write_text(json.dumps(bp, ensure_ascii=False, indent=2), encoding="utf-8")
        (out_dir / "chapters_outline.json").write_text(json.dumps(chaps, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[generator] Blueprint & chapters outline saved to {out_dir}")


if __name__ == '__main__':
    main()
