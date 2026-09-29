# -*- coding: utf-8 -*-
"""
Story Script Audio Parser v4.0 (Production-Grade).
Parses long-form multi-chapter storytelling scripts into structured audio manifests
supporting VieNeu-TTS v3 Turbo 48kHz, Edge-TTS, and OmniVoice.
Features:
- Dynamic Tag Extractor ([SPEAKER:role_id])
- Quote & In-line Attribution De-coupler
- Conversational Dialogue Turn State Machine (Alternating dialogue tracker)
- Dynamic Blueprint Character Entity Extractor
- Dynamic Dramatic Silence Padding Engine (180ms - 1400ms)
- EBU R128 (-16 LUFS) audio synthesis configuration
"""

import sys
import os
import re
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional, Set

sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("script_parser_v4")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
PROFILES_FILE = REPO_ROOT / "web_vn" / "data" / "voice_profiles" / "voices.json"

BASE_SPEAKER_ALIAS_MAP = {
    # ── Narrator ─────────────────────────────────────────────────────────────
    "bac_sam": "bac_sam",
    "host_sam": "bac_sam",
    "sam": "bac_sam",
    "van_sam": "bac_sam",
    "narrator": "bac_sam",
    "nguoi_dan_chuyen": "bac_sam",

    # ── Protagonist / Victim (canonical) ─────────────────────────────────────
    "nhan_vat_chinh": "nhan_vat_chinh",
    "nu_chinh": "nhan_vat_chinh",
    "minh_ha": "nhan_vat_chinh",
    "thu_ha": "nhan_vat_chinh",
    "ha": "nhan_vat_chinh",
    "nu_trung_uy": "nhan_vat_chinh",
    "bac_si": "nhan_vat_chinh",

    # ── Female Antagonists → ke_phan_dien_nu (canonical) ─────────────────────
    # Covers: me_chong, tieu_tam, me_gia, con_dau and all female villain archetypes
    "ke_phan_dien_nu": "ke_phan_dien_nu",
    # Legacy IDs (backward compat with old manifests and topic_seed files):
    "me_chong": "ke_phan_dien_nu",
    "ba_ly": "ke_phan_dien_nu",
    "ba_lanh": "ke_phan_dien_nu",
    "ba_me": "ke_phan_dien_nu",
    "ba_hoa": "ke_phan_dien_nu",
    "ba_lien": "ke_phan_dien_nu",
    "tieu_tam": "ke_phan_dien_nu",
    "con_dau": "ke_phan_dien_nu",
    "con_dau_hon": "ke_phan_dien_nu",
    "vo_ngoai_tinh": "ke_phan_dien_nu",
    "thanh_vy": "ke_phan_dien_nu",
    "khanh_ly": "ke_phan_dien_nu",
    "ly": "ke_phan_dien_nu",
    "vy": "ke_phan_dien_nu",
    "nhan_tinh_nu": "ke_phan_dien_nu",
    "tra": "ke_phan_dien_nu",
    "linh": "ke_phan_dien_nu",
    "mai": "ke_phan_dien_nu",
    "me_gia": "ke_phan_dien_nu",
    "ba_me_que": "ke_phan_dien_nu",
    "me_ngheo": "ke_phan_dien_nu",
    "me_liet_si": "ke_phan_dien_nu",
    "me_de": "ke_phan_dien_nu",

    # ── Male Supporting / Antagonists → ke_phan_dien_nam (canonical) ─────────
    # Covers: chong_boi_bac, can_bo, bo_chong, nguoi_chong and all male archetypes
    "ke_phan_dien_nam": "ke_phan_dien_nam",
    # Legacy IDs (backward compat):
    "chong_boi_bac": "ke_phan_dien_nam",
    "con_trai": "ke_phan_dien_nam",
    "con_trai_nhu_nhuoc": "ke_phan_dien_nam",
    "con_trai_bat_hieu": "ke_phan_dien_nam",
    "nhan_tinh": "ke_phan_dien_nam",
    "pham_hoang_vu": "ke_phan_dien_nam",
    "hoang_vu": "ke_phan_dien_nam",
    "vu": "ke_phan_dien_nam",
    "hung": "ke_phan_dien_nam",
    "duc_trong": "ke_phan_dien_nam",
    "troc_phu": "ke_phan_dien_nam",
    "can_bo": "ke_phan_dien_nam",
    "canh_sat": "ke_phan_dien_nam",
    "dong_doi": "ke_phan_dien_nam",
    "luat_su": "ke_phan_dien_nam",
    "cong_an": "ke_phan_dien_nam",
    "thieu_tuong": "ke_phan_dien_nam",
    "chu_tich": "ke_phan_dien_nam",
    "bo_chong": "ke_phan_dien_nam",
    "ong_lao": "ke_phan_dien_nam",
    "cuu_binh": "ke_phan_dien_nam",
    "dai_ta": "ke_phan_dien_nam",
    "bo_gia": "ke_phan_dien_nam",
    "ong_bo": "ke_phan_dien_nam",
    "bo_de": "ke_phan_dien_nam",
    "an_nhan": "ke_phan_dien_nam",
    "nguoi_an_nhan": "ke_phan_dien_nam",
    "thay_giao": "ke_phan_dien_nam",
    "nguoi_chong": "ke_phan_dien_nam",
    "chong_cuu_binh": "ke_phan_dien_nam",
    "trung_ta": "ke_phan_dien_nam",
    "si_quan": "ke_phan_dien_nam",
    "anh_chong": "ke_phan_dien_nam",
    "nam_chinh": "ke_phan_dien_nam",
}


_FEMALE_CUE_REGEX = re.compile(
    r"\b(mẹ chồng|bà lành|bà lý|bà hoa|bà mẹ|tiểu tam|khánh ly|thanh vy|ly nói|ly đáp|ly cười|"
    r"em chúc chị|chị .* về rồi|em xin lỗi chị|mẹ già|mẹ quát|mẹ nói|con dâu|mẹ đẻ|vợ tôi|"
    r"cô ta|cô ấy|ả|người đàn bà|nhân tình nữ|em đang có thai|chị dâu|bác gái)\b",
    re.IGNORECASE
)

_MALE_CUE_REGEX = re.compile(
    r"\b(chồng tôi|con trai|bố chồng|anh ấy|anh quát|anh bảo|anh nói|ông bố|"
    r"cán bộ|công an|cảnh sát|điều tra viên|thiếu tướng|đại tá|trung tá|luật sư|"
    r"gã|hắn|ông ta|nhân tình|vũ|hoàng vũ|tuấn|hưng|bố tôi|ông cụ)\b",
    re.IGNORECASE
)

_NARRATOR_CUE_REGEX = re.compile(
    r"\b(bác sâm|sâm kể chuyện|kính chào quý vị|chúc quý vị|đêm nay bác sâm)\b",
    re.IGNORECASE
)


def heal_speaker_tags(
    text: str,
    default_role: str = "nhan_vat_chinh",
    alias_map: Optional[Dict[str, str]] = None
) -> str:
    """
    Deterministically heals bare [SPEAKER] tags without role_id by analyzing local context.
    First normalizes all speaker tags onto their own lines to prevent multi-tag line pollution,
    then evaluates each segment independently.

    Ensures 0% bare tag fallthrough even if LLM ignores format instructions or omits newlines.
    System fix: Applied in both ChatGPT story pipeline wrapper and manifest parser.
    """
    if not text:
        return text

    # Step 1: Normalize all [SPEAKER...] tags to always begin on a newline
    normalized = re.sub(r'(?<=\S)\s*(\[SPEAKER(?::[a-z0-9_]*)?\])\s*', r'\n\1 ', text)

    # If no bare tags exist, return normalized text
    if not re.search(r'\[SPEAKER(?::\s*)?\]', normalized):
        return normalized

    lines = normalized.split("\n")
    healed_count = 0
    result_lines = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            result_lines.append(line)
            continue

        m = re.match(r'^\[SPEAKER(?::([a-z0-9_]*))?\]\s*(.*)$', stripped, re.DOTALL)
        if m:
            tag_role, content = m.group(1), m.group(2)
            if not tag_role:  # Bare tag [SPEAKER] or [SPEAKER:]
                c_low = content.lower()
                if _NARRATOR_CUE_REGEX.search(c_low):
                    assigned_role = "bac_sam"
                elif _FEMALE_CUE_REGEX.search(c_low):
                    assigned_role = "ke_phan_dien_nu"
                elif _MALE_CUE_REGEX.search(c_low):
                    assigned_role = "ke_phan_dien_nam"
                else:
                    assigned_role = default_role

                healed_line = f"[SPEAKER:{assigned_role}] {content}"
                result_lines.append(healed_line)
                healed_count += 1
            else:
                result_lines.append(line)
        else:
            result_lines.append(line)

    if healed_count > 0:
        logger.info(f"heal_speaker_tags: Auto-healed {healed_count} bare [SPEAKER] tags.")

    return "\n".join(result_lines)



class ConversationState:
    """Maintains scene-level conversation history and active participants."""
    def __init__(self, default_victim_speaker: str = "nhan_vat_chinh"):

        self.default_victim_speaker = default_victim_speaker
        self.last_speaker = default_victim_speaker
        self.active_participants: Set[str] = {default_victim_speaker}
        self.last_antagonist_nu = "ke_phan_dien_nu"
        self.last_antagonist_nam = "ke_phan_dien_nam"

    def record_turn(self, speaker_id: str):
        self.last_speaker = speaker_id
        self.active_participants.add(speaker_id)
        if speaker_id == "ke_phan_dien_nu":
            self.last_antagonist_nu = speaker_id
        elif speaker_id == "ke_phan_dien_nam":
            self.last_antagonist_nam = speaker_id

    def get_alternating_speaker(self, current_cue: str = "") -> str:
        """Determines alternating partner during rapid dialogue without attribution."""
        c_low = current_cue.lower()
        # Female vocative cues
        if any(w in c_low for w in ["em", "chị", "cô", "bác gái"]):
            return "ke_phan_dien_nu"
        # Male vocative cues
        if any(w in c_low for w in ["anh", "chú", "ông", "bác"]):
            return "ke_phan_dien_nam"
        # Default alternation
        if self.last_speaker == self.default_victim_speaker:
            return self.last_antagonist_nu
        return self.default_victim_speaker


def load_voice_profiles() -> Dict[str, Any]:
    if not PROFILES_FILE.exists():
        logger.error(f"Voice profiles file not found: {PROFILES_FILE}")
        return {}
    return json.loads(PROFILES_FILE.read_text(encoding="utf-8"))


def resolve_hybrid_voice_profile(
    speaker_id: str,
    topic_seed: Optional[Dict[str, Any]],
    voices: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Resolves the exact voice profile (Clone vs Native VieNeu) based on:
      1. Canonical speaker_id (bac_sam, nhan_vat_chinh, ke_phan_dien_nu, ke_phan_dien_nam)
      2. Topic Cluster & Archetype metadata in topic_seed.json
    """
    if speaker_id == "bac_sam":
        return voices.get("bac_sam", {})

    seed = topic_seed or {}
    victim_role = str(seed.get("voice_preset", {}).get("victim") or seed.get("victim_role", "")).lower()
    archetype = str(seed.get("archetype", "") + " " + seed.get("victim_role_name", "")).lower()
    cluster_id = str(seed.get("cluster_id", "")).lower()

    if speaker_id == "nhan_vat_chinh":
        # 1. Male Old Protagonist (Bố già, Thầy giáo, Bác cựu binh, Ân nhân)
        if any(k in archetype or k in victim_role for k in ["bo_chong", "bố", "ông", "cụ", "đại tá", "thầy", "ân nhân"]):
            return voices.get("nhan_vat_chinh_nam_gia", voices.get("nhan_vat_chinh", {}))
        # 2. Male Young/Middle Protagonist (Chồng cựu binh, Trung tá, Nam lính)
        elif any(k in archetype or k in victim_role for k in ["nguoi_chong", "chồng", "trung tá", "lính", "nam"]):
            return voices.get("nhan_vat_chinh_nam_tre", voices.get("nhan_vat_chinh", {}))
        # 3. Female Old Protagonist (Mẹ già, Mẹ quê, Mẹ liệt sĩ)
        elif any(k in archetype or k in victim_role for k in ["me_gia", "mẹ già", "mẹ quê", "bà mẹ"]):
            me_que_profile = dict(voices.get("nhan_vat_chinh_me_gia", {}))
            ref_path = me_que_profile.get("ref_audio", "")
            if ref_path and os.path.exists(ref_path):
                me_que_profile["use_ref_codes"] = True
            else:
                me_que_profile["use_ref_codes"] = False
                me_que_profile["ref_audio"] = ""
            return me_que_profile
        # 4. Female Young/Middle Protagonist (Default: Nữ cán bộ, Vợ hiền)
        else:
            return voices.get("nhan_vat_chinh_nu", voices.get("nhan_vat_chinh", {}))

    elif speaker_id == "ke_phan_dien_nu":
        # If cluster involves mother-in-law (Mẹ chồng cay nghiệt) -> Clone me-chong.mp3 (Mai Anh the thé)
        if "me_chong" in cluster_id or "mẹ chồng" in archetype:
            return voices.get("ke_phan_dien_nu_me_chong", voices.get("ke_phan_dien_nu", {}))
        # All other female villains (tiểu tam, con dâu hỗn, vợ ngoại tình) -> tieu-tam.mp3 / Native Trúc Ly
        else:
            return voices.get("ke_phan_dien_nu_tieu_tam", voices.get("ke_phan_dien_nu", {}))

    elif speaker_id == "ke_phan_dien_nam":
        # Young antagonist (chồng bội bạc, con trai, nhân tình) -> Native Phạm Tuyên
        return voices.get("ke_phan_dien_nam_tre", voices.get("ke_phan_dien_nam", {}))

    return voices.get(speaker_id, voices.get("bac_sam", {}))


def extract_blueprint_entities(story_dir: Path) -> Dict[str, str]:
    """Dynamically extracts custom character names from topic_seed.json and blueprint."""
    custom_map = {}
    seed_file = story_dir / "topic_seed.json"
    if seed_file.exists():
        try:
            seed = json.loads(seed_file.read_text(encoding="utf-8"))
            # Check characters object
            chars = seed.get("characters", {})
            for role_key, name in chars.items():
                clean_name = re.sub(r"[^\w\s]", "", name).lower().strip()
                if clean_name and role_key in BASE_SPEAKER_ALIAS_MAP:
                    custom_map[clean_name] = BASE_SPEAKER_ALIAS_MAP[role_key]
        except Exception as e:
            logger.debug(f"Blueprint entity extraction notice: {e}")
    return custom_map

def is_meta_text(text: str) -> bool:
    t_low = text.lower().strip()
    if len(t_low) < 3:
        return True
    if len(t_low) < 5 and not any(c.isalnum() for c in t_low):
        return True
    meta_keywords = [
        "dưới đây là", "kịch bản hoàn chỉnh", "kịch bản chi tiết", "blueprint",
        "speaker tag", "ngôi thứ nhất", "phần này dừng", "turn 1", "turn 2",
        "turn 3", "turn 4", "turn 5", "turn 6", "hệ thống speaker", "master blueprint",
        "bản viết liền mạch", "đúng blueprint đã duyệt", "hồi 1 & hồi 2", "hồi 3", "hồi 4", "hồi 5",
        "chương 1–3", "chương 4–6", "chương 7–9", "chương 10 & lời kết", "phần này kết",
        "hồ sơ nhân vật", "tiêu đề", "khung 5 hồi", "dàn ý chi tiết", "outlier tropes"
    ]
    for kw in meta_keywords:
        if kw in t_low:
            return True

    # Filter standalone onomatopoeia / sound effect lines (e.g. "Ù... O...", "RẦM!", "Choang!", "CỐP!")
    sfx_keywords = ["rầm", "cốp", "rắc", "cạch", "choang", "tách", "bốp", "bụp", "xoảng", "vút"]
    if any(siren in t_low for siren in ["ù... o", "ù...o", "u... o", "u...o", "ù o"]):
        return True
    words = t_low.split()
    if len(words) <= 3 and any(k in t_low for k in sfx_keywords) and not any(w in t_low for w in ["tôi", "mẹ", "con", "bà", "anh", "chị", "ông", "đứng", "nói", "nghe"]):
        return True

    return False

def clean_text_for_tts(text: str) -> str:
    """Cleans markdown, removes meta tags, strips stage directions, strips speaker labels."""
    text = re.sub(r"^#+\s*.*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"#+\s*", "", text)
    text = re.sub(r"\*{1,3}", "", text)
    text = re.sub(r"\[.*?\]", "", text)
    text = re.sub(r"\(.*?\)", "", text)
    text = re.sub(r">>\s*", "", text)
    text = re.sub(r"--+|==+", " ", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"\b\d{1,2}:\d{2}(:\d{2})?\b", "", text)
    
    # Strip leading character name labels (e.g. "Bác Sâm: ", "Minh Hà: ", "Khánh Ly: ")
    text = re.sub(
        r"^(?:bác\s+sâm|người\s+dẫn\s+chuyện|nhân\s+vật\s+chính|nữ\s+chính|minh\s+hà|thu\s+hà|hà|"
        r"mẹ\s+chồng|bà\s+lý|bà\s+lành|bà\s+mẹ|tiểu\s+tam|thanh\s+vy|khánh\s+ly|vy|ly|"
        r"chồng\s+bội\s+bạc|người\s+chồng|phạm\s+hoàng\s+vũ|hoàng\s+vũ|vũ|hưng|đức\s+trọng|chồng|"
        r"cán\s+bộ|công\s+an|cảnh\s+sát|công\s+chứng\s+viên|bố|mẹ)\s*:\s*",
        "",
        text,
        flags=re.IGNORECASE
    )

    for q in ['"', '“', '”', "'", '‘', '’']:
        text = text.replace(q, "")
    
    # Space after punctuation
    text = re.sub(r'([.!?…])([^\s0-9.!?…])', r'\1 \2', text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def split_into_sentence_chunks(text: str, max_words: int = 35) -> List[str]:
    """Splits into natural sentence chunks with appropriate breath limits (strictly max 35 words)."""
    raw_sentences = re.split(r"(?<=[.!?…])\s+", text)
    fine_sentences = []

    for sent in raw_sentences:
        sent = sent.strip()
        if not sent:
            continue
        words = sent.split()
        if len(words) <= max_words:
            fine_sentences.append(sent)
        else:
            # Split long run-on sentence on clause punctuation (, ; : — -)
            sub_clauses = re.split(r"(?<=[,;:\—\-])\s+", sent)
            sub_accum = []
            sub_w_count = 0
            for cl in sub_clauses:
                cl = cl.strip()
                if not cl:
                    continue
                cl_words = cl.split()
                if sub_w_count + len(cl_words) <= max_words:
                    sub_accum.append(cl)
                    sub_w_count += len(cl_words)
                else:
                    if sub_accum:
                        fine_sentences.append(" ".join(sub_accum))
                    if len(cl_words) > max_words:
                        for i in range(0, len(cl_words), max_words):
                            fine_sentences.append(" ".join(cl_words[i:i + max_words]))
                        sub_accum = []
                        sub_w_count = 0
                    else:
                        sub_accum = [cl]
                        sub_w_count = len(cl_words)
            if sub_accum:
                fine_sentences.append(" ".join(sub_accum))

    chunks = []
    current_chunk = []
    current_words = 0

    for sent in fine_sentences:
        sent = sent.strip()
        if not sent:
            continue
        words = len(sent.split())
        if current_words + words <= max_words:
            current_chunk.append(sent)
            current_words += words
        else:
            if current_chunk:
                chunks.append(" ".join(current_chunk))
            current_chunk = [sent]
            current_words = words

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks

def _attribute_speaker_from_cue(
    cue_text: str,
    default_speaker: str,
    state,
    alias_map: dict,
) -> str:
    """
    Infers speaker from a preceding attribution cue phrase
    (e.g. 'con trai nói:', 'mẹ quát:', 'thằng Hùng quay lại').
    Used by both split_block_by_dialogue_lines() and decouple_quotes_and_dialogue().
    """
    cue_low = cue_text.lower().strip()
    if not cue_low:
        return default_speaker

    # Check alias_map for exact name match
    for name, role in alias_map.items():
        if name in cue_low:
            return role

    # Female antagonist cues
    if any(w in cue_low for w in [
        "mẹ chồng", "bà lý", "bà lành", "bà hoa", "bà mẹ", "bà đáp",
        "mẹ quát", "mẹ nói", "mẹ già", "mẹ đẻ", "mẹ bảo", "mẹ hỏi", "mẹ trả lời",
        "khánh ly", "thanh vy", "cô ta", "tiểu tam", "ly nói", "ly đáp", "ly cười",
        "con dâu", "chị dâu", "bà nói", "bà quát", "bà hỏi",
    ]):
        return "ke_phan_dien_nu"

    # Male antagonist / supporting cues
    if any(w in cue_low for w in [
        "con trai", "thằng con", "anh ấy", "anh quát", "anh bảo", "anh nói",
        "bố tôi", "ông bố", "bố hỏi", "ông cụ", "ông lão", "bố chồng",
        "cán bộ", "công an", "cảnh sát", "điều tra viên", "công chứng viên",
        "vũ", "hoàng vũ", "hùng", "tuấn",
    ]):
        return "ke_phan_dien_nam"

    # Protagonist self-reference
    if any(w in cue_low for w in ["tôi", "cháu", "mình", "minh hà", "thu hà"]):
        return default_speaker

    return state.get_alternating_speaker(cue_low) if state else default_speaker


# Matches: "Con trai nhìn mẹ, nói:", "Thằng Hùng quay lại:", "Mẹ quát lên:"
_ATTRIBUTION_COLON_RE = re.compile(
    r'^(.{3,80}?(?:nói|hỏi|đáp|quát|thì thầm|rên|kêu|cười|bảo|trả lời|lên tiếng'
    r'|thở dài|nhìn|quay lại|gật đầu|lắc đầu|bước ra|bước vào|ghé lại|ngẩng lên|cúi xuống).*?):\s*(.+)$',
    re.IGNORECASE | re.DOTALL,
)

# Matches hyphen-prefix dialogue lines: "- ..." or "– ..."
_HYPHEN_LINE_RE = re.compile(r'^[-–]\s+(.+)$')

# Strip surrounding Vietnamese/ASCII quote chars
_STRIP_QUOTES_RE = re.compile(r'^[\u201c\u201d\u201e\u2018\u2019\'\"\s]+|[\u201c\u201d\u201e\u2018\u2019\'\"\s]+$')


def split_block_by_dialogue_lines(
    text: str,
    default_speaker: str = "nhan_vat_chinh",
    state=None,
    alias_map=None,
) -> list:
    """
    Splits a multi-line narrative block that contains embedded dialogue lines.

    Pattern A — Hyphen-prefix dialogue line (line starts with - or –):
        "Mẹ lặng nhìn con trai.\\n- Con đi rồi mẹ nhé."
        → narrative stays nhan_vat_chinh; hyphen line attributed via context.

    Pattern B — Colon attribution within one line:
        "Thằng Hùng quay lại nói: Bán nhà đi mẹ ạ."
        → ke_phan_dien_nam for speech part.

    Pattern C — Plain consecutive lines → accumulated as narrative, then
        standard quote-decouple applied.
    """
    aliases = alias_map or BASE_SPEAKER_ALIAS_MAP
    lines = text.split("\n")

    # Single-line → delegate to standard decouple
    if len(lines) <= 1:
        return decouple_quotes_and_dialogue(text, default_speaker, state, aliases)

    result = []
    narrative_accum = []
    last_narrative_cue = ""

    def flush_narrative():
        chunk = " ".join(narrative_accum).strip()
        if chunk:
            sub = decouple_quotes_and_dialogue(chunk, default_speaker, state, aliases)
            result.extend(sub)
        narrative_accum.clear()

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Pattern A: hyphen-prefix → dialogue
        m_hyp = _HYPHEN_LINE_RE.match(line)
        if m_hyp:
            flush_narrative()
            dialogue_text = m_hyp.group(1).strip()
            spk = _attribute_speaker_from_cue(last_narrative_cue, default_speaker, state, aliases)
            if spk == default_speaker and state:
                spk = state.get_alternating_speaker(dialogue_text)
            clean_d = _STRIP_QUOTES_RE.sub("", dialogue_text).strip()
            if clean_d:
                result.append((clean_d, spk))
                if state:
                    state.record_turn(spk)
            continue

        # Pattern B: colon-attribution within one line
        m_col = _ATTRIBUTION_COLON_RE.match(line)
        if m_col:
            cue_part = m_col.group(1).strip()
            speech_part = m_col.group(2).strip()
            spk = _attribute_speaker_from_cue(cue_part, default_speaker, state, aliases)
            if cue_part:
                narrative_accum.append(cue_part)
                flush_narrative()
                last_narrative_cue = cue_part
            clean_speech = _STRIP_QUOTES_RE.sub("", speech_part).strip()
            if clean_speech:
                result.append((clean_speech, spk))
                if state:
                    state.record_turn(spk)
            continue

        # Default: accumulate as narrative
        last_narrative_cue = line
        narrative_accum.append(line)

    flush_narrative()
    return result if result else [(text, default_speaker)]


def decouple_quotes_and_dialogue(
    text: str,
    default_speaker: str = "nhan_vat_chinh",
    state=None,
    alias_map=None,
) -> list:
    """
    De-couples mixed narrative and quoted dialogue in a paragraph.
    For multi-line blocks delegates to split_block_by_dialogue_lines().
    Handles: quote marks ("..."), hyphen prefix (- ...), colon attribution.
    """
    aliases = alias_map or BASE_SPEAKER_ALIAS_MAP

    # Multi-line block → richer splitter
    if "\n" in text.strip():
        return split_block_by_dialogue_lines(text, default_speaker, state, aliases)

    stripped = text.strip()

    # Hyphen-prefix single line
    if stripped.startswith(("-", "–")):
        clean_dialogue = re.sub(r'^[-–]\s*', '', stripped).strip()
        speaker = state.get_alternating_speaker(clean_dialogue) if state else default_speaker
        return [(clean_dialogue, speaker)]

    # Colon-attribution single line
    m_col = _ATTRIBUTION_COLON_RE.match(stripped)
    if m_col:
        cue_part = m_col.group(1).strip()
        speech_part = m_col.group(2).strip()
        spk = _attribute_speaker_from_cue(cue_part, default_speaker, state, aliases)
        result = []
        if cue_part:
            result.append((cue_part, default_speaker))
        clean_speech = _STRIP_QUOTES_RE.sub("", speech_part).strip()
        if clean_speech:
            result.append((clean_speech, spk))
        return result if result else [(text, default_speaker)]

    # Standard quote-mark extraction
    quote_pattern = r'([\u201c\u201d\"\u2018\u2019\'](.*?[^\\])[\u201c\u201d\"\u2018\u2019\'])'
    matches = list(re.finditer(quote_pattern, text))
    if not matches:
        return [(text, default_speaker)]

    result = []
    last_idx = 0
    for match in matches:
        start, end = match.span()
        pre_text = text[last_idx:start].strip()
        quote_text = match.group(2).strip()

        attributed_speaker = _attribute_speaker_from_cue(pre_text, default_speaker, state, aliases)

        if pre_text:
            result.append((pre_text, default_speaker))
        if quote_text:
            result.append((quote_text, attributed_speaker))

        last_idx = end

    post_text = text[last_idx:].strip()
    if post_text:
        result.append((post_text, default_speaker))

    return result

def classify_speaker(text: str, chapter: int, part_idx: int, total_parts: int, default_victim_speaker: str = "nhan_vat_chinh") -> Tuple[str, str]:
    """
    Classifies speaker into one of 4 canonical roles based on linguistic cues.
    Simplified from 8-branch (9 IDs) to 4-branch (4 IDs) to match voice consolidation.

    System lesson: fewer target classes → fewer heuristic misses → better attribution.
    """
    t_clean = clean_text_for_tts(text)
    t_low = t_clean.lower().strip()

    # 1. bac_sam — Narrator (Chapter 1 intro + Chapter 10 outro)
    if chapter == 1 and part_idx <= 4:
        return "bac_sam", "ch1_intro"
    if chapter == 10 and any(kw in t_low for kw in [
        "quý vị và các bạn thân mến", "bác sâm xin phép", "bác sâm mong rằng",
        "bác sâm tin rằng", "kính chúc quý vị", "hẹn gặp lại quý vị",
        "đăng ký kênh sâm kể chuyện", "chúc quý vị một đêm an lành",
        "gieo nhân nào", "buông tay là tự cứu", "công cha như núi", "bách thiện hiếu"
    ]):
        return "bac_sam", "ch10_outro"
    if t_low.startswith("kính chào quý vị") or t_low.startswith("đêm nay bác sâm") or t_low.startswith("sâm kể chuyện"):
        return "bac_sam", "explicit_sam"

    # 2. ke_phan_dien_nu — Female antagonist cues (merge: me_chong + tieu_tam + me_gia)
    female_antagonist_cues = [
        r"\bcon ăn thêm miếng\b",
        r"\bđang nghén thì\b",
        r"\bđi khỏi nhà con trai tôi\b",
        r"\bnhà này đứng tên con trai tôi\b",
        r"\btiền con trai tôi\b",
        r"\bnhà này là của thằng\b",
        r"\bcon trai tôi ngoan ngoãn\b",
        r"\bcon trai tôi làm ăn đàng hoàng\b",
        r"\bcô níu kéo\b",
        r"\bcon ly nó đã có thai\b",
        r"\bmẹ xin con\b",
        r"\bmẹ biết mẹ sai rồi\b",
        r"\bcon có hận mẹ không\b",
        r"\bcác anh nhầm người rồi\b",
        r"\bem chúc chị\b",
        r"\bchị .* về rồi ạ\b",
        r"\bem xin lỗi chị\b",
        r"\bem đang có thai\b",
        r"\bem không muốn giành giật\b",
        r"\banh .* muốn em chuyển về\b",
        r"\bsau này dù sao em cũng phải sống ở đây\b",
        r"\bông già lẩm cẩm\b",
        r"\bđưa sổ tiết kiệm đây\b",
        r"\bbà nhà quê lên đây\b",
        r"\bvứt hết mấy thứ quà quê\b",
        r"\bmẹ không cho con được nhiều\b",
        r"\bphụ nữ lấy chồng, trong tay nên có một chút của riêng\b",
        r"\bgiữ lại ít nhất hai chỉ\b",
    ]
    if any(re.search(pat, t_low) for pat in female_antagonist_cues):
        return "ke_phan_dien_nu", "female_antagonist_match"

    # 3. ke_phan_dien_nam — Male supporting/antagonist cues (merge: chong + can_bo + bo)
    male_cues = [
        r"\bcơ quan (?:cảnh sát điều tra|công an|điều tra)\b",
        r"\byêu cầu (?:tất cả )?giữ nguyên\b",
        r"\bđọc lệnh bắt\b",
        r"\bniêm (?:phong|giữ) (?:tài liệu|hồ sơ)\b",
        r"\bchúng tôi là cán bộ\b",
        r"\blập (?:biên bản|vi bằng)\b",
        r"\bmời (?:ông|bà|anh|chị) về trụ sở\b",
        r"\banh muốn ly hôn\b",
        r"\banh đã chuẩn bị rồi\b",
        r"\bnếu không có gì vướng thì ký luôn\b",
        r"\btài sản ai người ấy giữ\b",
        r"\bchúng ta đã hết rồi\b",
        r"\bcăn nhà này là của anh\b",
        r"\btôi không làm giả chữ ký\b",
        r"\banh chỉ mượn để xoay vốn\b",
        r"\btha cho anh\b",
        r"\bhà, cứu anh\b",
        r"\bbố ký vào giấy ủy quyền đi\b",
        r"\bmẹ về quê đi cho chúng con nhờ\b",
        r"\bbố không phản đối\b",
        r"\bbố tin con\b",
        r"\bcon chắc .* đáng để con làm thế chứ\b",
    ]
    if any(re.search(pat, t_low) for pat in male_cues):
        return "ke_phan_dien_nam", "male_cue_match"

    # 4. Default: Protagonist / Narrator voice
    return default_victim_speaker, "default_narrator"


def compute_dynamic_silence_padding(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Computes dynamic silence padding (ms) based on narrative context and speaker transitions.
    - Same speaker continuing clause: 180ms - 220ms
    - Same speaker paragraph end: 320ms
    - Transition to another speaker: 480ms - 600ms (dramatic pacing)
    - Chapter transition: 1400ms (clear inter-chapter breathing)
    """
    total = len(entries)
    for i in range(total):
        curr = entries[i]
        if i == total - 1:
            curr["silence_after_ms"] = 1500
            continue

        nxt = entries[i + 1]
        curr_spk = curr["speaker_id"]
        nxt_spk = nxt["speaker_id"]
        curr_ch = curr["chapter"]
        nxt_ch = nxt["chapter"]

        if curr_ch != nxt_ch:
            curr["silence_after_ms"] = 1400
        elif curr_spk != nxt_spk:
            # Dramatic speaker transition
            if "sam" in curr_spk or "sam" in nxt_spk:
                curr["silence_after_ms"] = 650
            elif "can_bo" in curr_spk or "can_bo" in nxt_spk:
                curr["silence_after_ms"] = 550
            else:
                curr["silence_after_ms"] = 480
        else:
            # Same speaker continuation
            curr_text = curr["text"].strip()
            if curr_text.endswith((".", "!", "?", "…")):
                curr["silence_after_ms"] = 280
            else:
                curr["silence_after_ms"] = 180

    return entries

def parse_script_to_manifest(script_path: Path, output_jsonl: Path) -> List[Dict[str, Any]]:
    """
    Parses full story script or individual turns into a structured JSONL audio manifest v4.0.
    """
    voices = load_voice_profiles()
    default_voice = voices.get("bac_sam", {})
    story_dir = script_path.parent

    # Dynamic blueprint character mappings
    alias_map = dict(BASE_SPEAKER_ALIAS_MAP)
    custom_entities = extract_blueprint_entities(story_dir)
    alias_map.update(custom_entities)

    # Phase A: In the 4-role canonical architecture, the protagonist (first-person narrator)
    # is ALWAYS and EXCLUSIVELY "nhan_vat_chinh".
    # Archetypes like "Người chồng cựu binh", "Bố già", "Nữ trung úy" are narrative character names,
    # NEVER mapped through alias_map (which would wrongly alias "nguoi_chong"/"bo_chong" -> "ke_phan_dien_nam").
    default_victim_speaker = "nhan_vat_chinh"
    seed_file = story_dir / "topic_seed.json"
    seed_data = {}
    if seed_file.exists():
        try:
            seed_data = json.loads(seed_file.read_text(encoding="utf-8"))
            victim_role_name = seed_data.get("victim_role_name", seed_data.get("archetype", "Nhân vật chính"))
            logger.debug(f"Story archetype '{victim_role_name}' -> speaker voice locked to '{default_victim_speaker}'")
        except Exception:
            pass

    state = ConversationState(default_victim_speaker=default_victim_speaker)


    turns = [
        ("turn2_chapters_1_3.md", [
            (1, r"CHƯƠNG\s*1\b.*?(?=CHƯƠNG\s*2\b|Phần này dừng|$)"),
            (2, r"CHƯƠNG\s*2\b.*?(?=CHƯƠNG\s*3\b|Phần này dừng|$)"),
            (3, r"CHƯƠNG\s*3\b.*?(?=Phần này dừng|$)")
        ]),
        ("turn3_chapters_4_6.md", [
            (4, r"CHƯƠNG\s*4\b.*?(?=CHƯƠNG\s*5\b|Phần này dừng|$)"),
            (5, r"CHƯƠNG\s*5\b.*?(?=CHƯƠNG\s*6\b|Phần này dừng|$)"),
            (6, r"CHƯƠNG\s*6\b.*?(?=Phần này dừng|chương sáu|$)")
        ]),
        ("turn4_chapters_7_9.md", [
            (7, r"CHƯƠNG\s*7\b.*?(?=CHƯƠNG\s*8\b|Phần này dừng|$)"),
            (8, r"CHƯƠNG\s*8\b.*?(?=CHƯƠNG\s*9\b|Phần này dừng|$)"),
            (9, r"CHƯƠNG\s*9\b.*?(?=Phần này kết|$)")
        ]),
        ("turn5_chapter_10_outro.md", [
            (10, r"(?:CHƯƠNG\s*10\b|##\s*PHẦN\s*4|\[SPEAKER:).*?(?=$)")
        ])
    ]

    all_entries = []
    chunk_idx = 1

    # Check if individual turn files exist
    turn_files_exist = all((story_dir / t[0]).exists() for t in turns)

    if turn_files_exist:
        for filename, ch_patterns in turns:
            file_path = story_dir / filename
            raw_text = file_path.read_text(encoding="utf-8")
            raw_text = heal_speaker_tags(raw_text, default_role=default_victim_speaker, alias_map=alias_map)
            raw_text = re.sub(r'CHƯƠNG\s*248', 'CHƯƠNG 2 48', raw_text)
            raw_text = re.sub(r'CHƯƠNG\s*89', 'CHƯƠNG 8 9', raw_text)
            raw_text = re.sub(r'CHƯƠNG\s*(\d+)([A-ZÀ-Ỹ])', r'CHƯƠNG \1 \2', raw_text)


            for ch_idx, pattern in ch_patterns:
                m = re.search(pattern, raw_text, re.DOTALL | re.IGNORECASE)
                if not m:
                    logger.error(f"Could not extract Chapter {ch_idx} from {filename}")
                    continue
                ch_text = m.group(0)

                # Extract tagged blocks with regex capturing role_id if present
                tagged_blocks = []
                splits = re.split(r'\[SPEAKER(?::([a-z0-9_]+))?\]', ch_text)
                i = 1
                while i < len(splits):
                    role_tag = splits[i]
                    content = splits[i+1] if i + 1 < len(splits) else ""
                    if content.strip():
                        tagged_blocks.append((role_tag, content.strip()))
                    i += 2

                if not tagged_blocks:
                    raw_parts = [p.strip() for p in re.split(r'\n+', ch_text) if p.strip()]
                    tagged_blocks = [(None, p) for p in raw_parts]

                valid_blocks = []
                for role_tag, p in tagged_blocks:
                    clean_p = re.sub(r'^CHƯƠNG\s*\d+.*?\n', '', p, flags=re.IGNORECASE).strip()
                    clean_p = re.sub(r'^CHƯƠNG\s*\d+\s+[A-ZÀ-Ỹ\s0-9–—-]+(?:\n|$)', '', clean_p, flags=re.IGNORECASE).strip()
                    if not clean_p or is_meta_text(clean_p):
                        continue
                    valid_blocks.append((role_tag, clean_p))

                total_blocks = len(valid_blocks)
                for p_idx, (role_tag, part) in enumerate(valid_blocks, start=1):
                    decoupled = decouple_quotes_and_dialogue(
                        part,
                        default_speaker=default_victim_speaker,
                        state=state,
                        alias_map=alias_map
                    )

                    for sub_text, sub_speaker in decoupled:
                        clean_text = clean_text_for_tts(sub_text)
                        if not clean_text or len(clean_text.split()) < 2:
                            continue

                        # Resolve speaker
                        if role_tag and role_tag.strip() and role_tag.strip() in alias_map:
                            speaker_id = alias_map[role_tag.strip()]
                        elif sub_speaker != default_victim_speaker:
                            speaker_id = alias_map.get(sub_speaker, sub_speaker)
                        else:
                            speaker_id, reason = classify_speaker(clean_text, ch_idx, p_idx, total_blocks, default_victim_speaker=default_victim_speaker)
                            speaker_id = alias_map.get(speaker_id, speaker_id)

                        # Update conversation state
                        state.record_turn(speaker_id)
                        v_profile = resolve_hybrid_voice_profile(speaker_id, seed_data, voices)

                        sub_chunks = split_into_sentence_chunks(clean_text, max_words=35)
                        for sub in sub_chunks:
                            entry = {
                                "id": f"chunk_{chunk_idx:05d}",
                                "chapter": ch_idx,
                                "speaker_id": speaker_id,
                                "text": sub,
                                "words": len(sub.split()),
                                "engine": v_profile.get("engine", "vieneu"),
                                "voice": v_profile.get("voice"),
                                "style": v_profile.get("style", "doc_truyen" if speaker_id == "bac_sam" else "tu_nhien"),
                                "temperature": v_profile.get("temperature", 0.80),
                                "top_p": v_profile.get("top_p", 0.95),
                                "top_k": v_profile.get("top_k", 25),
                                "silence_p": v_profile.get("silence_p", 0.0 if speaker_id != "bac_sam" else 0.15),
                                "repetition_penalty": v_profile.get("repetition_penalty", 1.05 if speaker_id != "bac_sam" else 1.2),
                                "ref_audio": v_profile.get("ref_audio", ""),
                                "ref_text": v_profile.get("ref_text", ""),
                                "use_ref_codes": v_profile.get("use_ref_codes", True),
                                "language_id": "vi",
                                "speed": v_profile.get("speed", 0.96),
                                "guidance_scale": v_profile.get("guidance_scale", 2.2),
                                "instruct": v_profile.get("instruct", ""),
                                "silence_after_ms": 200,
                                "target_lufs": -16.0
                            }

                            all_entries.append(entry)
                            chunk_idx += 1
    else:
        # Fallback to single full_story_script.md
        raw_text = script_path.read_text(encoding="utf-8")
        raw_text = heal_speaker_tags(raw_text, default_role=default_victim_speaker, alias_map=alias_map)
        raw_text = re.sub(r'CHƯƠNG\s*248', 'CHƯƠNG 2 48', raw_text)
        raw_text = re.sub(r'CHƯƠNG\s*89', 'CHƯƠNG 8 9', raw_text)
        raw_text = re.sub(r'CHƯƠNG\s*(\d+)([A-ZÀ-Ỹ])', r'CHƯƠNG \1 \2', raw_text)


        for filename, ch_patterns in turns:
            for ch_idx, pattern in ch_patterns:
                m = re.search(pattern, raw_text, re.DOTALL | re.IGNORECASE)
                if not m:
                    continue
                ch_text = m.group(0)

                tagged_blocks = []
                splits = re.split(r'\[SPEAKER(?::([a-z0-9_]+))?\]', ch_text)
                i = 1
                while i < len(splits):
                    role_tag = splits[i]
                    content = splits[i+1] if i + 1 < len(splits) else ""
                    if content.strip():
                        tagged_blocks.append((role_tag, content.strip()))
                    i += 2

                if not tagged_blocks:
                    raw_parts = [p.strip() for p in re.split(r'\n+', ch_text) if p.strip()]
                    tagged_blocks = [(None, p) for p in raw_parts]

                valid_blocks = []
                for role_tag, p in tagged_blocks:
                    clean_p = re.sub(r'^CHƯƠNG\s*\d+.*?\n', '', p, flags=re.IGNORECASE).strip()
                    clean_p = re.sub(r'^CHƯƠNG\s*\d+\s+[A-ZÀ-Ỹ\s0-9–—-]+(?:\n|$)', '', clean_p, flags=re.IGNORECASE).strip()
                    if not clean_p or is_meta_text(clean_p):
                        continue
                    valid_blocks.append((role_tag, clean_p))

                total_blocks = len(valid_blocks)
                for p_idx, (role_tag, part) in enumerate(valid_blocks, start=1):
                    decoupled = decouple_quotes_and_dialogue(
                        part,
                        default_speaker=default_victim_speaker,
                        state=state,
                        alias_map=alias_map
                    )

                    for sub_text, sub_speaker in decoupled:
                        clean_text = clean_text_for_tts(sub_text)
                        if not clean_text or len(clean_text.split()) < 2:
                            continue

                        if role_tag and role_tag.strip() and role_tag.strip() in alias_map:
                            speaker_id = alias_map[role_tag.strip()]
                        elif sub_speaker != default_victim_speaker:
                            speaker_id = alias_map.get(sub_speaker, sub_speaker)
                        else:
                            speaker_id, reason = classify_speaker(clean_text, ch_idx, p_idx, total_blocks, default_victim_speaker=default_victim_speaker)
                            speaker_id = alias_map.get(speaker_id, speaker_id)

                        state.record_turn(speaker_id)
                        v_profile = resolve_hybrid_voice_profile(speaker_id, seed_data, voices)

                        sub_chunks = split_into_sentence_chunks(clean_text, max_words=35)
                        for sub in sub_chunks:
                            entry = {
                                "id": f"chunk_{chunk_idx:05d}",
                                "chapter": ch_idx,
                                "speaker_id": speaker_id,
                                "text": sub,
                                "words": len(sub.split()),
                                "engine": v_profile.get("engine", "vieneu"),
                                "voice": v_profile.get("voice"),
                                "style": v_profile.get("style", "doc_truyen" if speaker_id == "bac_sam" else "tu_nhien"),
                                "temperature": v_profile.get("temperature", 0.80),
                                "top_p": v_profile.get("top_p", 0.95),
                                "top_k": v_profile.get("top_k", 25),
                                "silence_p": v_profile.get("silence_p", 0.0 if speaker_id != "bac_sam" else 0.15),
                                "repetition_penalty": v_profile.get("repetition_penalty", 1.05 if speaker_id != "bac_sam" else 1.2),
                                "ref_audio": v_profile.get("ref_audio", ""),
                                "ref_text": v_profile.get("ref_text", ""),
                                "use_ref_codes": v_profile.get("use_ref_codes", True),
                                "language_id": "vi",
                                "speed": v_profile.get("speed", 0.96),
                                "guidance_scale": v_profile.get("guidance_scale", 2.2),
                                "instruct": v_profile.get("instruct", ""),
                                "silence_after_ms": 200,
                                "target_lufs": -16.0
                            }

                            all_entries.append(entry)
                            chunk_idx += 1

    # Post-process dynamic dramatic silence padding
    all_entries = compute_dynamic_silence_padding(all_entries)

    output_jsonl.parent.mkdir(parents=True, exist_ok=True)
    with output_jsonl.open("w", encoding="utf-8") as f:
        for item in all_entries:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    total_words = sum(e["words"] for e in all_entries)
    logger.info(f"Parsed {len(all_entries)} clean audio chunks ({total_words:,} words) across 10 chapters.")
    logger.info(f"Saved Production-Grade manifest to: {output_jsonl}")

    return all_entries

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Parse Story Script to Audio Manifest")
    parser.add_argument("--story-id", type=str, default="story_e2e_test_01", help="Story ID to process")
    parser.add_argument("--script", type=str, default=None, help="Explicit path to script md")
    parser.add_argument("--output", type=str, default=None, help="Explicit path to output manifest jsonl")
    args = parser.parse_args()

    if args.script:
        script_file = Path(args.script)
        out_file = Path(args.output) if args.output else script_file.parent / "audio_manifest.jsonl"
    else:
        s_id = args.story_id if args.story_id.startswith("story_") else f"story_{args.story_id}"
        s_dir = REPO_ROOT / "web_vn" / "output" / s_id
        script_file = s_dir / "full_story_script.md"
        out_file = s_dir / "audio_manifest.jsonl"

    if script_file.exists():
        parse_script_to_manifest(script_file, out_file)
    else:
        logger.error(f"Script not found at: {script_file}")
