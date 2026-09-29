# -*- coding: utf-8 -*-
"""
DRAMA HÀN STORY PIPELINE (9ROUTER GEMINI API POWERED - HIGHEST QUALITY EDITION)
Authentic Korean Radio Drama / Sayeon Audiobook Pipeline modeled after top Korean channels like '사연만남'.

Generates full 8-act episodic scripts (50m - 90m target, 8,000 - 10,000 Korean words / 25,000+ chars)
using hierarchical multi-turn prompting via 9Router Gemini API Gateway.
Supports dual-format output:
1. Clean Audiobook Monologue (for single-voice natural TTS)
2. Speaker-Tagged Multi-Voice Script ([SPEAKER:role] for multi-actor TTS)
"""

from __future__ import annotations

import os
import re
import json
import asyncio
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple

from auto_yt.paths import DATA_DIR, PROJECT_ROOT
from auto_yt.gemini_api_engine import get_gemini_api_engine, GeminiApiEngine
from auto_yt.kr_topic_matrix import (
    KrTopicMatrix,
    KrTopicRegistry,
    get_kr_topic_registry,
    RELATIONSHIPS,
    CATALYSTS,
    REVERSALS,
    EMOTIONAL_TONES,
)

logger = logging.getLogger("DramaKrPipeline")

OUTPUT_DIR = PROJECT_ROOT / "output_drama_kr"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Kênh 사연만남 Signature Hooks
SIGNATURE_INTRO_CTA = (
    "사연 시작전 좋아요 한 번만 눌러 주세요. "
    "지금 어디서 듣고 계신지 댓글로 알려 주시면 그곳에 건강과 큰 복이 함께하시길 응원하겠습니다. "
    "사연 시작합니다."
)

SIGNATURE_OUTRO_CTA = (
    "오늘 이야기가 마음에 닿으셨다면 구독과 좋아요 버튼을 눌러 주세요. "
    "카카오톡으로 가족, 친구, 이웃들과 영상 공유해 주세요. "
    "다음에도 더 감동적이고 통쾌한 사연으로 찾아뵙겠습니다. "
    "시청해 주셔서 진심으로 감사드립니다."
)

# 5 Cụm chủ đề K-Drama Top View từ phân tích thực tế
TOPIC_CLUSTERS: Dict[str, Dict[str, Any]] = {
    "cluster_kr_stepfamily": {
        "id": "cluster_kr_stepfamily",
        "name": "계모의 30년 헌신 & 의붓형제의 절도 참교육 (Mẹ kế hy sinh & Con riêng trộm cắp)",
        "archetypes": ["주인공(교수/전문직)", "계모(시장 전집 운영)", "의붓남동생(도박/탐욕)", "변호사친구", "동네상인"],
        "default_voice_roles": {
            "nguoi_dan": "nguoi_dan",
            "nu_chinh": "주인공",
            "me_ke": "계모",
            "em_trai": "의붓남동생",
            "luat_su": "변호사",
        },
        "description": "피 한 방울 안 섞인 계모가 시장에서 전을 부치며 키워준 딸. 집을 사드리려 모은 2억이 사라졌는데, 병원에 쓰러진 계모의 방에서 30년간 딸 이름으로 모아둔 수억 원의 통장이 발견되고 의붓남동생을 처벌하는 통쾌하고 감동적인 이야기.",
        "sample_titles": [
            "계모는 저를 교수까지 공부시켜주었어요. 집을 사드리고 싶어 2억을 모았고, 돈을 찾으러 은행에 찾아갔더니 창구 직원의 한마디에 주저앉아 울어버렸습니다.",
            "의붓남동생이 내 전재산 2억 훔쳐 달아난 날 쓰러진 계모, 단칸방 낡은 옷장에서 발견된 보따리에 온 집안이 오열했습니다",
            "피 한 방울 안 섞인 딸에게 30년 통장 넘긴 계모, 도둑질한 의붓아들에게 던진 서류 한 장에 경찰차 출동하는데!",
        ],
    },
    "cluster_kr_gobu": {
        "id": "cluster_kr_gobu",
        "name": "고부갈등 & 며느리의 통쾌한 사이다 반격 (Mẹ chồng gia trưởng & Nàng dâu lật ngược thế cờ)",
        "archetypes": ["주인공(며느리/간호사/자수성가)", "시어머니(가부장적/편애)", "남편(우유부단/방관)", "시누이/동서(이기적)", "친정어머니"],
        "default_voice_roles": {
            "nguoi_dan": "nguoi_dan",
            "con_dau": "주인공",
            "me_chong": "시어머니",
            "chong": "남편",
            "si_nu": "시누이",
        },
        "description": "출산 직후나 제삿날에도 며느리만 종 부리듯 혹사시키고 부자 동서/시누이만 편애하던 시모. 며느리가 지원을 끊고 숨겨둔 자산과 실체를 공개하자 시댁 전체가 무릎 꿇고 손이 발이 되도록 비는 이야기.",
        "sample_titles": [
            "시댁 제삿날, 제왕절개 출산 후 쉬고 있는데 병원 찾아와 수술부위 꾹 누르는 시모, '애 낳은 게 벼슬이냐?' 그 순간 남편이 시모 뺨따구를 날리는데!",
            "친정엄마 항암비 3천만원을 시누이 혼수비로 빼돌린 시모 '곧 죽을 노인네보다 산 사람이 중요하지!' 저는 웃으며 카드를 정지시켰어요",
            "둘째며느리는 30억 건물주고 저만 쏙 빼놔서 저도 암 치료비 간병비 지원 끊었습니다 '나눠준 사람들한테 받으세요'",
        ],
    },
    "cluster_kr_cheating": {
        "id": "cluster_kr_cheating",
        "name": "불륜 남편 & 내연녀 완벽 파멸 참교육 (Bắt quả tang ngoại tình & Thu hồi tài sản)",
        "archetypes": ["주인공(전문직 아내)", "남편(외도/위선)", "내연녀(사치/뻔뻔)", "시누이(불륜 조력자)", "조력의사/탐정"],
        "default_voice_roles": {
            "nguoi_dan": "nguoi_dan",
            "nu_chinh": "주인공",
            "chong": "남편",
            "tieu_tam": "내연녀",
            "si_nu": "시누이",
        },
        "description": "내가 산 명품 옷과 전세금을 빼돌려 시누이 친구인 내연녀와 밀회를 즐기던 남편. 남편의 치명적인 질병/비리 진단서를 먼저 확보한 아내가 차분하게 증거를 모아 이혼과 동시에 전재산을 회수하고 두 사람을 파멸시키는 이야기.",
        "sample_titles": [
            "병원 근무하는 내가 남편의 암을 알게되고 말해 주려는데 내연녀와 함께 있는 남편을 보게 되고 '이왕 이렇게 걸린 거 그냥 이혼하자' 남편놈 인생이 그날로 종쳤습니다",
            "절친과 바람난 남편을 목격하고도 저는 소란을 피우지 않았어요. 그저 조용히 모든 계좌를 동결하고 지켜봤을 뿐입니다",
            "남편이 내연녀와 해외 출장가는 날, 나를 찾아온 사람은 내연녀 시어머니였습니다 '우리, 동맹 맺읍시다!' 불륜 두 년놈 인생 개박살 냈습니다",
        ],
    },
    "cluster_kr_dongseo": {
        "id": "cluster_kr_dongseo",
        "name": "학벌/직업 무시하는 동서 & 신분 역전 사이다 (Chị em dâu khinh miệt & Lộ diện thân phận)",
        "archetypes": ["주인공(자수성가/알짜 건물주)", "교수/의사 동서(오만/학벌지상주의)", "시어머니(차별)", "호텔총지배인/회장", "남편"],
        "default_voice_roles": {
            "nguoi_dan": "nguoi_dan",
            "nu_chinh": "주인공",
            "dong_seo": "동서",
            "me_chong": "시어머니",
            "tong_giam_doc": "총지배인",
        },
        "description": "고졸이라며 마트 알바나 청소부 취급하며 가족 모임마다 공개 망신을 주던 교수 동서와 시모. 고급 호텔이나 백화점 모임에서 총지배인과 회장이 90도로 깍듯이 인사하며 드러난 주인공의 진짜 정체에 동서가 기절하는 이야기.",
        "sample_titles": [
            "마트알바하는 나만 보면 되도않는 프랑스어로 말하는 동서년. 호텔 메뉴판 보면서 '무식한 형님이 읽을라나?' 총지배인 달려와 90도 절하며 하는 말에 동서년 개거품물고 쓰러지는데",
            "서울대 나온 동서가 고졸인 내게 '형님 무식해서 어디 가서 말도 못 섞겠네' 시모가 내 서류 한 장 꺼내자 동서년 하얗게 질려 졸도하는데!",
            "청담동 고급 레스토랑에 등산복 입고 온 내게 '쪽팔리니 구석에서 쳐드세요!'라고 말하는 동서, 10초 뒤 지배인이 내게 달려와 '회장님 드디어 와주셨군요!'",
        ],
    },
    "cluster_kr_inheritance": {
        "id": "cluster_kr_inheritance",
        "name": "유산 분쟁 & 노후 부모 버린 자식의 비참한 최후 (Tranh chấp di chúc & Quả báo bất hiếu)",
        "archetypes": ["주인공(효심 깊은 둘째/양자)", "장남/큰며느리(패륜/재산 강탈)", "시아버지/어머니(치매 위장/진실 파악)", "변호사"],
        "default_voice_roles": {
            "nguoi_dan": "nguoi_dan",
            "nu_chinh": "주인공",
            "con_truong": "장남",
            "nguoi_cha": "시아버지",
            "luat_su": "변호사",
        },
        "description": "살아계실 땐 아파트와 상가를 모두 장남에게 주었으나 정작 병이 나자 장남 부부는 시골 폐가나 요양원에 부모를 버림. 끝까지 곁을 지킨 며느리에게 부모님이 남긴 낡은 성경책/고물금고 속 숨겨진 수백억 유산과 장남의 몰락.",
        "sample_titles": [
            "치매 시어머니가 동서들에겐 강남아파트와 벤츠를 주고, 맏며느리인 저에겐 헌 성경책을 던졌습니다. 집에 와서 펼쳐보니... 상상도 못한 유언장에 온 집안이 뒤집어지는데!",
            "다리 없는 시아버지 똥오줌 받아가며 모셨는데 유산으로 흉가만 남긴 시아버지. 감정원에서 다급한 전화 한 통 '이 흉가 지하에서 발견된 게 뭔지 아십니까?'",
            "진짜 아들들은 아파트주고 친조카 양아들인 남편은 고물금고를 유산으로 준 시아버지. 형제들 조롱 속에 고물금고를 열고 기절하고 마는데!",
        ],
    },
}


def count_korean_metrics(text: str) -> Dict[str, Any]:
    """Tính toán các chỉ số độ dài tiếng Hàn chuẩn xác."""
    clean_text = re.sub(r'\[SPEAKER:[^\]]+\]', '', text).strip()
    words = clean_text.split()
    chars_no_space = len(re.sub(r'\s+', '', clean_text))
    chars_with_space = len(clean_text)
    
    # Dự đoán thời lượng audio (tốc độ đọc radio Hàn trung bình ~300-350 âm tiết/phút)
    estimated_audio_minutes = round(chars_no_space / 320, 1)
    
    return {
        "word_count": len(words),
        "char_count_no_space": chars_no_space,
        "char_count_with_space": chars_with_space,
        "estimated_audio_minutes": estimated_audio_minutes,
        "is_length_qualified": len(words) >= 7500 or chars_no_space >= 22000,
    }


def validate_speaker_tags(text: str) -> Dict[str, Any]:
    """Kiểm tra tính hợp lệ của các tag nhân vật [SPEAKER:role_id]."""
    all_tags = re.findall(r'\[SPEAKER(?::([a-zA-Z0-9_\uac00-\ud7a3]*))?\]', text, re.IGNORECASE)
    total = len(all_tags)
    with_id = sum(1 for t in all_tags if t and t.strip())
    empty = total - with_id
    roles = sorted(list(set(t.strip() for t in all_tags if t and t.strip())))
    return {
        "total": total,
        "with_id": with_id,
        "empty": empty,
        "empty_ratio": round(empty / total, 3) if total > 0 else 0.0,
        "roles": roles,
        "has_no_tags": total == 0,
    }


def heal_speaker_tags(text: str, default_role: str = "nguoi_dan") -> str:
    """Tự động chuẩn hóa và sửa các tag [SPEAKER] thiếu role_id."""
    def _repl(match):
        role = match.group(1)
        if not role or not role.strip():
            return f"[SPEAKER:{default_role}]"
        return f"[SPEAKER:{role.strip()}]"

    healed = re.sub(r'\[SPEAKER(?::([a-zA-Z0-9_\uac00-\ud7a3]*))?\]', _repl, text)
    return healed


def extract_clean_audiobook_text(text: str) -> str:
    """
    Chuyển đổi kịch bản có tag sang bản văn xuôi Audiobook mượt mà,
    loại bỏ mọi thẻ tag kỹ thuật để đưa trực tiếp vào engine TTS đơn giọng đọc.
    """
    clean = re.sub(r'\[SPEAKER:[^\]]+\]\s*', '', text)
    clean = re.sub(r'#{1,6}\s+.*?\n', '', clean)  # Bỏ markdown headers
    clean = re.sub(r'\n{3,}', '\n\n', clean).strip()
    return clean


class DramaKrPipeline:
    """
    Pipeline điều phối tạo kịch bản Drama Hàn Quốc chuẩn Radio Sayeon 8 Giai đoạn.
    Chất lượng cao nhất qua 9Router Gemini API Gateway.
    """

    def __init__(
        self,
        engine: Optional[GeminiApiEngine] = None,
        model: str = "ag/gemini-3.8-flash-medium",
        output_base_dir: Optional[Path] = None,
    ):
        self.engine = engine or get_gemini_api_engine(default_model=model)
        self.model = model
        self.output_base_dir = output_base_dir or OUTPUT_DIR

    async def generate_story(
        self,
        topic_seed: Optional[Dict[str, Any]] = None,
        cluster_id: Optional[str] = None,
        matrix_combo: Optional[Dict[str, Any]] = None,
        custom_prompt: Optional[str] = None,
        story_slug: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Thực hiện toàn bộ quy trình 8 Giai đoạn tạo kịch bản Radio Drama tiếng Hàn đỉnh cao.
        Hỗ trợ cả Cluster truyền thống và Ma trận 4 Chiều (4D Matrix).
        """
        registry = get_kr_topic_registry()
        
        # Nếu có matrix_combo hoặc yêu cầu dùng matrix
        if matrix_combo:
            seed = matrix_combo
            combo_hash = matrix_combo.get("combo_hash", "")
            cluster_name = f"{matrix_combo.get('rel_name', '')} x {matrix_combo.get('cat_name', '')}"
            slug_prefix = f"matrix_{combo_hash[:8]}"
        elif topic_seed and "combo_hash" in topic_seed:
            seed = topic_seed
            combo_hash = topic_seed.get("combo_hash", "")
            cluster_name = f"{topic_seed.get('rel_name', '')} x {topic_seed.get('cat_name', '')}"
            slug_prefix = f"matrix_{combo_hash[:8]}"
        else:
            c_id = cluster_id or "cluster_kr_stepfamily"
            cluster_info = TOPIC_CLUSTERS.get(c_id, TOPIC_CLUSTERS["cluster_kr_stepfamily"])
            seed = topic_seed or {
                "cluster_id": c_id,
                "title": cluster_info["sample_titles"][0],
                "summary": cluster_info["description"],
                "custom_prompt": custom_prompt or "",
            }
            combo_hash = seed.get("combo_hash", "")
            cluster_name = cluster_info["name"]
            slug_prefix = f"drama_kr_{c_id}"

        slug = story_slug or f"{slug_prefix}_{int(asyncio.get_event_loop().time())}"
        story_dir = self.output_base_dir / slug
        story_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"🚀 [DramaKrPipeline] Bắt đầu quy trình K-Drama cao cấp: {slug}")
        logger.info(f"📌 Chủ đề: {cluster_name}")

        (story_dir / "topic_seed.json").write_text(json.dumps(seed, ensure_ascii=False, indent=2), encoding="utf-8")

        # -------------------------------------------------------------
        # STAGE 1: Viral Hook & Character Dossier
        # -------------------------------------------------------------
        logger.info("🎬 [Stage 1/8] Thiết kế Cold Open Hook & Hồ sơ nhân vật...")
        prompt_s1 = self._build_stage1_prompt(seed, {"name": cluster_name, "description": seed.get("summary", "")})
        s1_response, _ = await self.engine.generate_content(prompt=prompt_s1, model=self.model, temperature=0.7)
        (story_dir / "stage1_hook_and_characters.md").write_text(s1_response, encoding="utf-8")

        # -------------------------------------------------------------
        # STAGE 2: Master 8-Act Beat Sheet & Timeline
        # -------------------------------------------------------------
        logger.info("📋 [Stage 2/8] Thiết kế Dàn ý 8 Màn kịch tính (Beat Sheet & Financial Details)...")
        prompt_s2 = self._build_stage2_prompt(s1_response, {"name": cluster_name, "description": seed.get("summary", "")})
        s2_response, _ = await self.engine.generate_content(prompt=prompt_s2, model=self.model, temperature=0.7)
        (story_dir / "stage2_beat_sheet.md").write_text(s2_response, encoding="utf-8")

        # -------------------------------------------------------------
        # STAGE 3: Act 1 & 2 Generation (Khởi đầu & Dấu hiệu bất thường ~2,500 từ)
        # -------------------------------------------------------------
        logger.info("✍️ [Stage 3/8] Đang viết Màn 1 & Màn 2 (Cold Open, Quá khứ ấm áp, Rạn nứt đầu tiên)...")
        prompt_s3 = self._build_stage3_prompt(s1_response, s2_response)
        s3_response, _ = await self.engine.generate_content(prompt=prompt_s3, model=self.model, temperature=0.75)
        s3_healed = heal_speaker_tags(s3_response)
        (story_dir / "stage3_acts_1_2.md").write_text(s3_healed, encoding="utf-8")

        # -------------------------------------------------------------
        # STAGE 4: Act 3 & 4 Generation (Cú sốc phản bội & Sự thật bí mật ~2,500 từ)
        # -------------------------------------------------------------
        logger.info("⚡ [Stage 4/8] Đang viết Màn 3 & Màn 4 (Cú sốc trắng tay, Bí mật phòng cũ, Quyết tâm trả thù)...")
        prompt_s4 = self._build_stage4_prompt(s1_response, s2_response, s3_healed)
        s4_response, _ = await self.engine.generate_content(prompt=prompt_s4, model=self.model, temperature=0.75)
        s4_healed = heal_speaker_tags(s4_response)
        (story_dir / "stage4_acts_3_4.md").write_text(s4_healed, encoding="utf-8")

        # -------------------------------------------------------------
        # STAGE 5: Act 5 & 6 Generation (Bày binh bố trận & Kích hoạt cái bẫy ~2,500 từ)
        # -------------------------------------------------------------
        logger.info("💥 [Stage 5/8] Đang viết Màn 5 & Màn 6 (Tư vấn pháp lý, Giăng bẫy ghi âm, Kẻ ác sa lưới)...")
        prompt_s5 = self._build_stage5_prompt(s1_response, s2_response, s4_healed)
        s5_response, _ = await self.engine.generate_content(prompt=prompt_s5, model=self.model, temperature=0.75)
        s5_healed = heal_speaker_tags(s5_response)
        (story_dir / "stage5_acts_5_6.md").write_text(s5_healed, encoding="utf-8")

        # -------------------------------------------------------------
        # STAGE 6: Act 7 & 8 Generation (Trừng phạt kẻ ác, Hoá giải & Outro ~2,500 từ)
        # -------------------------------------------------------------
        logger.info("🏆 [Stage 6/8] Đang viết Màn 7 & Màn 8 (Pháp luật trừng trị, Ngôi nhà mới, Lời bộc bạch & Outro)...")
        prompt_s6 = self._build_stage6_prompt(s1_response, s2_response, s5_healed)
        s6_response, _ = await self.engine.generate_content(prompt=prompt_s6, model=self.model, temperature=0.7)
        s6_healed = heal_speaker_tags(s6_response)
        (story_dir / "stage6_acts_7_8.md").write_text(s6_healed, encoding="utf-8")

        # -------------------------------------------------------------
        # STAGE 7: Quality Gate & Formatting (Dual Output)
        # -------------------------------------------------------------
        logger.info("🔍 [Stage 7/8] Kiểm định chất lượng (Quality Gate) & Xuất bản kép...")
        full_multivoice_script = f"{s3_healed}\n\n{s4_healed}\n\n{s5_healed}\n\n{s6_healed}"
        (story_dir / "full_story_multivoice.md").write_text(full_multivoice_script, encoding="utf-8")

        full_audiobook_text = extract_clean_audiobook_text(full_multivoice_script)
        (story_dir / "full_story_audiobook.txt").write_text(full_audiobook_text, encoding="utf-8")

        metrics = count_korean_metrics(full_audiobook_text)
        tag_stats = validate_speaker_tags(full_multivoice_script)

        # -------------------------------------------------------------
        # STAGE 8: YouTube Package & SEO Metadata
        # -------------------------------------------------------------
        logger.info("🏷️ [Stage 8/8] Đang tạo gói SEO YouTube tiếng Hàn (Title, Tags, Thumbnail Prompts)...")
        prompt_s8 = self._build_stage8_prompt(s1_response, s2_response, seed)
        s8_response, _ = await self.engine.generate_content(prompt=prompt_s8, model=self.model, temperature=0.7)
        (story_dir / "stage8_youtube_seo_package.md").write_text(s8_response, encoding="utf-8")

        summary_result = {
            "slug": slug,
            "combo_hash": combo_hash,
            "cluster_id": cluster_id or "matrix",
            "cluster_name": cluster_name,
            "rel_name": seed.get("rel_name", ""),
            "cat_name": seed.get("cat_name", ""),
            "rev_name": seed.get("rev_name", ""),
            "tone_name": seed.get("tone_name", ""),
            "status": "completed",
            "output_dir": str(story_dir),
            "metrics": metrics,
            "tag_stats": tag_stats,
            "model_used": self.model,
            "files": {
                "audiobook_clean": str(story_dir / "full_story_audiobook.txt"),
                "multivoice_script": str(story_dir / "full_story_multivoice.md"),
                "seo_package": str(story_dir / "stage8_youtube_seo_package.md"),
            }
        }

        # Tự động đăng ký vào Topic Registry nếu có combo_hash
        if combo_hash:
            registry.register_completed_story(combo_hash, summary_result)

        (story_dir / "pipeline_state.json").write_text(
            json.dumps(summary_result, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        logger.info(
            f"✨ [DramaKrPipeline] TẠO KỊCH BẢN THÀNH CÔNG: {slug} "
            f"({metrics['word_count']} từ / {metrics['char_count_no_space']} ký tự tiếng Hàn, "
            f"Dự kiến: ~{metrics['estimated_audio_minutes']} phút audio)"
        )
        return summary_result

    # -------------------------------------------------------------------------
    # PROMPT BUILDERS (TIẾNG HÀN NGUYÊN BẢN CHUẨN XÁC NATE PANN / SAYEON MANNAM)
    # -------------------------------------------------------------------------

    def _build_stage1_prompt(self, seed: Dict[str, Any], cluster: Dict[str, Any]) -> str:
        return f"""
당신은 대한민국 1위 유튜브 오디오북 및 사연 라디오 채널(사연만남, 네이트판 레전드 썰)의 수석 메인 드라마 작가입니다.
시청자가 첫 10초 만에 절대 이탈하지 않고 1시간 이상 끝까지 몰입해서 듣게 만드는 **[기획서 및 캐릭터 프로필]**을 작성하세요.

【기본 정보】
- 대주제 분류: {cluster['name']}
- 핵심 줄거리 시드: {seed.get('summary', cluster['description'])}
- 추가 요청사항: {seed.get('custom_prompt', '없음')}

【작성 요구사항】
1. **유튜브 클릭률(CTR) 극대화 제목 3가지**:
   - [공식 A]: 충격적 핍박/도둑질/배신 상황 + 냉정한 침묵/반응 + 악역의 파멸(개거품, 졸도, 무릎 꿇음)
   - [공식 B]: 평범한 일상 속 의문의 경고/단서 + 충격적인 질문 ("뭘 알고 있었을까요?")
   - [공식 C]: 무시당하던 주인공의 숨겨진 정체/서류 한 장 + 악역의 경악과 참교육
2. **0분 0초 오프닝 인 미디어스 레스(In Medias Res) 훅 (약 300자)**:
   - 이야기의 가장 절정인 충격적 순간(은행 잔고 0원 확인, 뺨을 맞은 순간, 불륜 현장 목격)으로 즉시 시작.
   - 뒤이어 채널 시그니처 멘트 반드시 포함:
     "{SIGNATURE_INTRO_CTA}"
3. **등장인물 상세 프로필 및 [SPEAKER:role] 태그 정의**:
   - 주인공 (1인칭 화자: 나/저): 나이, 직업, 성격, 억울하게 당했지만 냉정하고 치밀한 지략가.
   - 핵심 악역: 이기적이고 뻔뻔한 행동 양식, 특유의 말투.
   - 조력자: 헌신적인 부모/계모, 든든한 변호사 친구 등.

출력 언어: 한국어 (전문가 수준의 완벽한 문장과 감정 묘사).
"""

    def _build_stage2_prompt(self, stage1_text: str, cluster: Dict[str, Any]) -> str:
        return f"""
다음은 작성된 기획서와 캐릭터 프로필입니다:
---
{stage1_text}
---

위 기획을 바탕으로 80~90분 분량(약 8,500~10,000 단어)의 대작 사연 라디오드라마를 위한 **[8단 플롯 마스터 비트시트 (Beat Sheet)]**를 설계하세요.

【8단 플롯 구조】
- **제1막: 충격의 시작과 따뜻했던 과거** (인 미디어스 레스 훅, 주인공 자기소개, 은인/가족과의 눈물겨운 과거사)
- **제2막: 일상에 드리운 미세한 균열** (악역의 은밀한 무시, 가스라이팅, 소소한 물건/돈의 분실, 복선)
- **제3막: 파국과 배신의 현장** (믿었던 돈/자산의 강탈, 어머니/은인의 응급실 쓰러짐, 악역의 뻔뻔한 폭언)
- **제4막: 절망 속에서 발견된 진실** (단칸방/낡은 옷장에서 발견된 30년 통장/비밀 유언장, 피보다 진한 사랑 확인)
- **제5막: 냉정한 각성과 은밀한 전략** (분노를 감추고 차가운 미소 장착, 전문 변호사/경찰 상담, 친족상도례 등 법률 맹점 파악)
- **제6막: 덫을 놓다 (치밀한 유도와 증거 확보)** (악역에게 저자세로 접근하여 자백 녹음 확보, 계좌 추적, CCTV 증거 완성)
- **제7막: 무자비한 사이다 참교육과 파멸** (경찰 출동/구속, 악역 계좌 동결, 시댁/악역의 비참한 몰락과 무릎 꿇음)
- **제8막: 진정한 가족의 완성 및 에필로그** (어머니/은인을 위한 새집 마련, 눈물의 화해, 인생 교훈 및 아웃트로 CTA)

각 막마다 **구체적인 금액(예: 58만 원, 2억 원, 300억), 날짜/장소, 결정적 대사, 감각적 신체 묘사 키워드**를 명시하세요.
"""

    def _build_stage3_prompt(self, stage1: str, stage2: str) -> str:
        return f"""
당신은 한국 사연 라디오 작가입니다. 마스터 비트시트를 바탕으로 **[제1막 & 제2막]** 본문을 집필하세요.
목표 분량: **한국어 약 2,200 ~ 2,600 단어 (7,000~8,000 자)**의 매우 상세하고 몰입감 넘치는 소설/대본 형식.

【반드시 지켜야 할 집필 규칙】
1. **1인칭 주인공 시점 (저는 / 제가 / 나는)**으로 서술하며, 감정선과 신체 감각을 극도로 섬세하게 묘사하세요.
   (예: '손끝이 얼음장처럼 차가워졌다', '등줄기에 식은땀이 흘렀다', '심장이 쿵 내려앉았다')
2. **다자간 대화 태그 형식 준수**:
   모든 단락은 화자 태그로 시작해야 합니다:
   [SPEAKER:nguoi_dan] (전체 내레이션 및 주인공의 1인칭 독백)
   [SPEAKER:nu_chinh] (주인공의 직접 발화 대사)
   [SPEAKER:me_chong] 또는 [SPEAKER:me_ke] (어머니 대사)
   [SPEAKER:em_trai] 또는 [SPEAKER:si_nu] (악역 대사)
3. **제1막 시작 부분**:
   반드시 가장 충격적인 절정 훅으로 시작한 후, 다음 시그니처 멘트를 자연스럽게 넣고 본 이야기로 넘어가세요:
   "{SIGNATURE_INTRO_CTA}"
4. 구체적인 고유명사, 정확한 액수(원 단위), 식당/병원/은행 등 현장 묘사를 풍부하게 채워 넣으세요.

【참고 기획 및 플롯】
{stage1}
---
{stage2}
"""

    def _build_stage4_prompt(self, stage1: str, stage2: str, prev_acts: str) -> str:
        return f"""
이전 내용에 이어지는 **[제3막 & 제4막]** 본문을 집필하세요.
목표 분량: **한국어 약 2,200 ~ 2,600 단어 (7,000~8,000 자)**.

【주요 전개 내용】
- 제3막: 10년간 피땀 흘려 모은 돈(2억 등)이 통장에서 통째로 사라진 것을 확인하고 절망. 병원에서 어머니가 쓰러졌다는 다급한 연락. 병원에 나타난 악역의 뻔뻔한 태도와 막말.
- 제4막: 수술비조차 없어 막막한 상황에서 어머니의 낡은 단칸방 옷장을 뒤지다 발견된 두툼한 보자기를 품에 안음. 그 속에서 쏟아져 나온 주인공 이름으로 된 수십 개의 30년 통장들과 눈물겨운 메모들. 피 한 방울 안 섞인 어머니의 위대한 사랑을 깨닫고 오열하며 각성.

【집필 규칙】
1. 100% 1인칭 시점 및 모든 대사/내레이션에 [SPEAKER:role] 태그 철저히 부여.
2. 주인공이 슬픔에서 차가운 분노와 결의로 심리 상태가 전환되는 과정을 소름 돋게 묘사.
3. 앞선 1, 2막과의 이름, 호칭, 사건의 연속성을 100% 일치시킬 것.

【이전 줄거리 요약】
{prev_acts[-1500:]}
"""

    def _build_stage5_prompt(self, stage1: str, stage2: str, prev_acts: str) -> str:
        return f"""
이전 내용에 이어지는 **[제5막 & 제6막]** 본문을 집필하세요.
목표 분량: **한국어 약 2,200 ~ 2,600 단어 (7,000~8,000 자)**.

【주요 전개 내용】
- 제5막: 주인공의 은밀한 전략 가동. 신뢰할 수 있는 변호사 친구를 찾아가 상담. 법률적 허점(친족상도례가 비혈연/별거 가족에게 적용되지 않는다는 법리)을 꿰뚫고 완벽한 법적 처벌 계획 수립.
- 제6막: 주인공은 악역 앞에서 오히려 아무것도 모르는 척, 힘없는 척하며 연기함. 악역을 안심시켜 스스로 돈을 훔쳤음을 실토하는 결정적 통화 녹음과 은행 CCTV, 스마트폰 명의도용 증거를 완벽히 확보함.

【집필 규칙】
1. 숨 막히는 심리전과 두뇌 싸움.
2. 모든 문장에 [SPEAKER:role] 태그 적용.
3. 변호사의 전문적 조언 대사와 주인공의 냉철한 내면 독백 교차.

【이전 줄거리 요약】
{prev_acts[-1500:]}
"""

    def _build_stage6_prompt(self, stage1: str, stage2: str, prev_acts: str) -> str:
        return f"""
이 드라마의 대미를 장식할 **[제7막 & 제8막 (결말 및 에필로그)]** 본문을 집필하세요.
목표 분량: **한국어 약 2,200 ~ 2,600 단어 (7,000~8,000 자)**.

【주요 전개 내용】
- 제7막: 통쾌한 사이다 심판! 악역이 경찰에 긴급 체포되고, 법의 심판대 앞에서 뒤늦게 무릎 꿇고 빌지만 주인공은 차갑게 외면함. 악역의 모든 자산 동결과 완전한 패망.
- 제8막: 어머니의 성공적인 수술과 퇴원. 어머니의 이름으로 된 햇살 가득한 새 아파트 선물. 식탁에서 나누는 따뜻한 밥 한 끼와 진정한 가족의 의미를 되새기는 깊은 감동.
- 에필로그 & 아웃트로: 인생의 진정한 가치와 인과응보에 대한 나지막한 독백. 그리고 채널 시그니처 멘트로 마무리:
  "{SIGNATURE_OUTRO_CTA}"

【집필 규칙】
1. 마지막 문장까지 1인칭 화자의 품격 있고 감동적인 어조 유지.
2. 모든 대사/독백에 [SPEAKER:role] 태그 적용.
3. 반드시 공식 아웃트로 CTA로 종결.

【이전 줄거리 요약】
{prev_acts[-1500:]}
"""

    def _build_stage8_prompt(self, stage1: str, stage2: str, seed: Dict[str, Any]) -> str:
        return f"""
완성된 대작 한국어 사연 라디오 드라마를 위한 **[유튜브 SEO 및 썸네일 패키지]**를 생성하세요.

【출력 형식】
# 1. 유튜브 클릭률(CTR) 극대화 제목 (최종 추천 3종)
- 유튜브 알고리즘에 최적화된 자극적이면서도 품격 있는 K-사연 스타일 제목.

# 2. 썸네일 제작을 위한 AI 프롬프트 (Midjourney / Stable Diffusion용 3종)
- 영문 프롬프트 (High quality, cinematic lighting, photorealistic Korean middle-aged woman, emotional dramatic expression 등 상세 묘사).
- 썸네일에 들어갈 강력한 한국어 텍스트 문구 3개 (예: "2억 훔친 남동생의 최후", "30년 만에 열린 비밀 통장").

# 3. 유튜브 영상 설명란 (Description)
- 첫 3줄 강력한 텍스트 훅.
- 8개 챕터 타임스탬프 (00:00 오프닝부터 ~ 1:25:00 결말까지).
- 채널 안내 문구 및 저작권 안내.

# 4. 유튜브 SEO 핵심 태그 (30개)
- 오디오북, 사연라디오, 네이트판, 고부갈등 등 고효율 알고리즘 태그.
"""
