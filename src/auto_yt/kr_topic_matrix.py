# -*- coding: utf-8 -*-
"""
4D K-DRAMA TOPIC MATRIX & TOPIC REGISTRY ENGINE
Combinatorial Topic Matrix for Korean Radio Drama / Sayeon Audiobook Channels (사연만남 Clone).

Mathematical Space:
- 8 Relationship Groups (RELATIONSHIPS)
- 6 Catalyst / Conflict Settings (CATALYSTS)
- 5 Reversal & Justice Mechanisms (REVERSALS)
- 3 Emotional Tone Variants (EMOTIONAL_TONES)
Total Unique Combinations: 8 * 6 * 5 * 3 = 720 Distinct Storylines.

Features:
- Deterministic 16-char MD5 combo_hash.
- Non-repeating fresh combo generation with automatic deduplication.
- Topic Registry persistence in data/kr_topic_registry.json.
- Real-time Matrix Coverage analytics.
"""

from __future__ import annotations

import json
import hashlib
import random
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple

from auto_yt.paths import DATA_DIR

logger = logging.getLogger("KrTopicMatrix")

REGISTRY_FILE = DATA_DIR / "kr_topic_registry.json"

# ==============================================================================
# 4 AXES DEFINITIONS (DATA-DRIVEN TỪ THỰC TẾ KÊNH 사연만남)
# ==============================================================================

RELATIONSHIPS: Dict[str, Dict[str, Any]] = {
    "rel_gobu": {
        "id": "rel_gobu",
        "name": "고부갈등 (시어머니 vs 며느리)",
        "korean_desc": "가부장적이고 편애가 심한 시어머니와 오랜 세월 희생하며 묵묵히 참아온 며느리의 갈등",
        "roles": {"protagonist": "며느리 (자수성가/전문직)", "antagonist": "시어머니", "bystander": "우유부단한 남편"},
    },
    "rel_dongseo": {
        "id": "rel_dongseo",
        "name": "동서갈등 (형님 vs 동서 / 학벌·직업 차별)",
        "korean_desc": "스펙과 집안을 내세워 주인공의 학벌과 직업을 사사건건 무시하고 망신 주는 오만한 동서",
        "roles": {"protagonist": "주인공 (고졸/자수성가 알짜 자산가)", "antagonist": "교수/의사 동서", "bystander": "시댁 식구들"},
    },
    "rel_sinu": {
        "id": "rel_sinu",
        "name": "시누이갈등 (시누이 vs 올케)",
        "korean_desc": "주인공의 명품과 자산을 탐내고 시댁 부모 뒤에 숨어 주인공을 종 취급하며 착취하는 시누이",
        "roles": {"protagonist": "올케 (알뜰하게 자산 모은 전문직)", "antagonist": "철없는 시누이", "bystander": "편드는 시모"},
    },
    "rel_cheating": {
        "id": "rel_cheating",
        "name": "부부 파탄 & 불륜 (남편 vs 아내 vs 내연녀)",
        "korean_desc": "주인공의 헌신으로 성공한 뒤 은밀히 친구/부하직원과 불륜을 저지르고 이혼을 요구하는 파렴치한 남편",
        "roles": {"protagonist": "아내 (냉철한 지략가)", "antagonist": "위선자 남편 & 사치스러운 내연녀", "bystander": "불륜 조력자"},
    },
    "rel_stepfamily": {
        "id": "rel_stepfamily",
        "name": "계모의 헌신 & 의붓형제 탐욕 (계모 vs 의붓자식)",
        "korean_desc": "피 한 방울 안 섞인 자식을 30년간 헌신으로 키워낸 계모와 그 은혜를 도둑질로 갚으려는 배은망덕한 의붓자식",
        "roles": {"protagonist": "딸 (교수/성공한 커리어)", "ally": "헌신적인 계모", "antagonist": "도박/사기꾼 의붓남동생"},
    },
    "rel_elderly_parent": {
        "id": "rel_elderly_parent",
        "name": "노부모 부양 & 패륜 자식 (부모 vs 불효 장남 vs 효자 둘째/양자)",
        "korean_desc": "재산만 가로채고 병든 늙은 부모를 폐가나 요양원에 버린 장남 부부와 끝까지 부모 곁을 지킨 자식",
        "roles": {"protagonist": "효심 깊은 둘째/양자", "ally": "숨겨진 진실을 아는 노부모", "antagonist": "패륜 장남 부부"},
    },
    "rel_inlaws": {
        "id": "rel_inlaws",
        "name": "사돈갈등 (안사돈 vs 사돈댁)",
        "korean_desc": "가난한 친정 부모를 거지 취급하며 뺨을 때리고 모욕을 준 교만한 사돈 집안",
        "roles": {"protagonist": "친정어머니/딸 (숨겨진 거물)", "antagonist": "오만한 사돈댁 안사돈", "bystander": "비겁한 사위"},
    },
    "rel_social": {
        "id": "rel_social",
        "name": "사회적 갑질 & 동창 무시 (동창/직장상사 vs 주인공)",
        "korean_desc": "30년 만의 동창회나 직장에서 주인공의 겉모습만 보고 공개적으로 망신과 갑질을 퍼붓는 trọc phú",
        "roles": {"protagonist": "조용한 자산가 주인공", "antagonist": "허세 가득한 동창/직장 대표", "bystander": "동창회 사람들"},
    },
}

CATALYSTS: Dict[str, Dict[str, Any]] = {
    "cat_family_event": {
        "id": "cat_family_event",
        "name": "명절 / 제삿날 / 칠순잔치 혹사 및 배제",
        "korean_desc": "제왕절개 출산 직후나 야근 후에도 홀로 차례상을 차리게 하고 자기들끼리만 하와이 여행을 떠난 사건",
        "keywords": ["제삿날", "추석 차례상", "칠순 잔치", "비행기표 빼돌림", "식모 취급"],
    },
    "cat_medical_crisis": {
        "id": "cat_medical_crisis",
        "name": "응급 수술비 / 암 투병 / 장기기증 위기",
        "korean_desc": "친정부모나 주인공의 긴급 수술비 3천만 원을 빼돌려 사치품을 사고 병간호를 방치한 사건",
        "keywords": ["암 조직검사", "긴급 개두술 1500만 원", "간이식 요구", "의사의 긴급 전화", "산소호흡기"],
    },
    "cat_financial_heist": {
        "id": "cat_financial_heist",
        "name": "2억 적금통장 / 전세금 / 명품 무단 절도",
        "korean_desc": "10년간 모은 전세금 2억 1,400만 원과 58만 원짜리 명품 실크 블라우스를 몰래 훔쳐 달아난 사건",
        "keywords": ["잔고 0원", "명의도용 스마트폰 뱅킹", "외제차 자랑 SNS", "OTP 카드 절도", "도어락 무단침입"],
    },
    "cat_high_society": {
        "id": "cat_high_society",
        "name": "특급호텔 / 청담동 레스토랑 / 상견례 모욕",
        "korean_desc": "등산복을 입거나 마트 알바를 한다며 고급 레스토랑 구석에 처박히라며 공개적으로 뺨을 때린 사건",
        "keywords": ["청담동 고급 식당", "프랑스어 메뉴판 조롱", "상견례 파투", "100명 예약 노쇼"],
    },
    "cat_unfair_inheritance": {
        "id": "cat_unfair_inheritance",
        "name": "상가건물 / 아파트 몰아주기 & 헌 성경책 유산",
        "korean_desc": "악역에겐 30억 건물과 아파트를 몰아주고 주인공에겐 빚더미 흉가나 낡은 고물금고만 던져준 사건",
        "keywords": ["유언장 공증", "30억 상가건물", "시골 폐가", "헌 성경책", "고물금고"],
    },
    "cat_class_discrimination": {
        "id": "cat_class_discrimination",
        "name": "고졸·마트알바·청소부 직업 무시 폭언",
        "korean_desc": "가방끈이 짧다며 수저 먼저 들었다고 뺨을 후려치고 명품 가방에 지문 묻었다고 폭언을 퍼부은 사건",
        "keywords": ["고졸 무식쟁이 조롱", "수세미 던짐", "지문 묻었다며 뺨 때림", "청소부 취급"],
    },
}

REVERSALS: Dict[str, Dict[str, Any]] = {
    "rev_hidden_identity": {
        "id": "rev_hidden_identity",
        "name": "총지배인·회장 90도 깍듯 인사 & 진짜 건물주 폭로",
        "korean_desc": "호텔 총지배인과 백화점 사장이 달려와 90도로 깍듯이 인사하며 드러난 주인공의 진짜 정체",
        "climax_event": "총지배인이 '회장님, 드디어 오셨습니까!' 외치는 순간 악역이 개거품 물고 졸도",
    },
    "rev_hidden_vault": {
        "id": "rev_hidden_vault",
        "name": "낡은 옷장 속 30년 통장 뭉치 & 비밀 유언장 발견",
        "korean_desc": "단칸방 낡은 보자기 속에서 발견된 수십 개의 30년 적금 통장과 딸 이름으로 된 알짜 상가 계약서",
        "climax_event": "수십 년간 주인공 몰래 모아둔 수억 원의 통장과 진심 어린 편지가 공개되며 대반전",
    },
    "rev_reverse_strike": {
        "id": "rev_reverse_strike",
        "name": "명의 카드 50장 전격 정지 & 상가·부동산 전액 압류",
        "korean_desc": "주인공이 지원하던 모든 법인/개인 카드와 병원비 지원을 즉시 끊고 재산을 전액 가압류 조치",
        "climax_event": "새 며느리 파티 도중 카드가 전부 정지되며 시댁이 빚더미와 함께 풍비박산",
    },
    "rev_legal_trap": {
        "id": "rev_legal_trap",
        "name": "친족상도례 맹점 활용 & 자백 녹음·CCTV 경찰 구속",
        "korean_desc": "비혈연 관계에는 친족상도례가 적용되지 않는다는 법리를 이용해 자백 유도 녹음 확보 후 긴급 체포",
        "climax_event": "가족이라 괜찮다며 뻔뻔하던 악역이 경찰서 유치장으로 직행하며 징역형 선고",
    },
    "rev_medical_shock": {
        "id": "rev_medical_shock",
        "name": "DNA 불일치 충격 & 암 조직검사 결과 독점 확보",
        "korean_desc": "수혈 과정에서 밝혀진 친자 불일치 진실 또는 남편의 말기 암 진단서를 주인공만 알고 있는 상황",
        "climax_event": "내연녀와 새 출발하겠다는 남편에게 암 진단서와 이혼 서류를 던지며 인생 종치게 만듦",
    },
}

EMOTIONAL_TONES: Dict[str, Dict[str, Any]] = {
    "tone_cider": {
        "id": "tone_cider",
        "name": "사이다 (Pure Justice & Humiliation)",
        "korean_desc": "악역의 뻔뻔함이 극에 달했다가 단칼에 무너지며 손이 발이 되도록 비는 통쾌하고 후련한 결말",
        "ending_vibe": "완벽한 인과응보와 통쾌한 사이다 승리",
    },
    "tone_tears": {
        "id": "tone_tears",
        "name": "눈물·감동 (Sacrifice & Deep Catharsis)",
        "korean_desc": "피보다 진한 사랑과 헌신, 뒤늦게 확인된 부모/은인의 위대한 희생으로 온 시청자를 울리는 감동 결말",
        "ending_vibe": "따뜻한 새집에서의 식사와 진정한 가족의 눈물겨운 화해",
    },
    "tone_karma": {
        "id": "tone_karma",
        "name": "소름 반전 (Chilling Karma & Fate)",
        "korean_desc": "욕망에 눈멀어 저지른 죄악이 고스란히 자기 목을 조르는 충격적이고 소름 돋는 운명의 장난",
        "ending_vibe": "모든 것을 잃고 길거리에 나앉은 악역의 비참한 최후와 주인공의 담담한 인생 성찰",
    },
}


# ==============================================================================
# KR TOPIC MATRIX GENERATOR CLASS
# ==============================================================================

class KrTopicMatrix:
    """Hệ thống tạo và quản lý tổ hợp ma trận chủ đề 4 chiều cho K-Drama."""

    @staticmethod
    def calculate_combo_hash(rel_id: str, cat_id: str, rev_id: str, tone_id: str) -> str:
        """Tạo mã băm MD5 16 ký tự duy nhất cho mỗi tổ hợp ma trận."""
        raw_key = f"{rel_id}|{cat_id}|{rev_id}|{tone_id}".encode("utf-8")
        return hashlib.md5(raw_key).hexdigest()[:16]

    @classmethod
    def get_all_combos(cls) -> List[Dict[str, Any]]:
        """Trả về toàn bộ 720 tổ hợp khả dĩ trong không gian ma trận."""
        combos = []
        for rel_id, rel in RELATIONSHIPS.items():
            for cat_id, cat in CATALYSTS.items():
                for rev_id, rev in REVERSALS.items():
                    for tone_id, tone in EMOTIONAL_TONES.items():
                        c_hash = cls.calculate_combo_hash(rel_id, cat_id, rev_id, tone_id)
                        combos.append({
                            "combo_hash": c_hash,
                            "rel_id": rel_id,
                            "cat_id": cat_id,
                            "rev_id": rev_id,
                            "tone_id": tone_id,
                            "rel_name": rel["name"],
                            "cat_name": cat["name"],
                            "rev_name": rev["name"],
                            "tone_name": tone["name"],
                        })
        return combos

    @classmethod
    def build_combo_seed(
        cls,
        rel_id: str,
        cat_id: str,
        rev_id: str,
        tone_id: str,
        custom_note: str = "",
    ) -> Dict[str, Any]:
        """Tạo đối tượng Topic Seed chi tiết từ 4 tọa độ ma trận."""
        rel = RELATIONSHIPS.get(rel_id, RELATIONSHIPS["rel_stepfamily"])
        cat = CATALYSTS.get(cat_id, CATALYSTS["cat_financial_heist"])
        rev = REVERSALS.get(rev_id, REVERSALS["rev_hidden_vault"])
        tone = EMOTIONAL_TONES.get(tone_id, EMOTIONAL_TONES["tone_tears"])

        c_hash = cls.calculate_combo_hash(rel["id"], cat["id"], rev["id"], tone["id"])

        summary_kr = (
            f"【관계 및 인물 구도】: {rel['korean_desc']}\n"
            f"【갈등 촉발 사건】: {cat['korean_desc']}\n"
            f"【클라이맥스 및 반격 장치】: {rev['korean_desc']}\n"
            f"【결말 및 감정선】: {tone['korean_desc']}"
        )

        return {
            "combo_hash": c_hash,
            "rel_id": rel["id"],
            "cat_id": cat["id"],
            "rev_id": rev["id"],
            "tone_id": tone["id"],
            "rel_name": rel["name"],
            "cat_name": cat["name"],
            "rev_name": rev["name"],
            "tone_name": tone["name"],
            "summary": summary_kr,
            "roles": rel.get("roles", {}),
            "keywords": cat.get("keywords", []),
            "climax_event": rev.get("climax_event", ""),
            "ending_vibe": tone.get("ending_vibe", ""),
            "custom_note": custom_note,
        }


# ==============================================================================
# KR TOPIC REGISTRY CLASS (CHỐNG TRÙNG LẶP DỮ LIỆU)
# ==============================================================================

class KrTopicRegistry:
    """Quản lý kho lưu trữ và lịch sử các chủ đề đã sản xuất trong data/kr_topic_registry.json."""

    def __init__(self, registry_path: Optional[Path] = None):
        self.registry_path = registry_path or REGISTRY_FILE
        self._ensure_registry_exists()

    def _ensure_registry_exists(self) -> None:
        if not self.registry_path.exists():
            self.registry_path.parent.mkdir(parents=True, exist_ok=True)
            initial_data = {
                "version": "1.0",
                "total_matrix_space": 720,
                "used_count": 0,
                "history": [],
            }
            self.registry_path.write_text(
                json.dumps(initial_data, ensure_ascii=False, indent=2), encoding="utf-8"
            )

    def load_registry(self) -> Dict[str, Any]:
        try:
            return json.loads(self.registry_path.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning(f"Không thể đọc registry {self.registry_path}: {e}, khởi tạo lại.")
            self._ensure_registry_exists()
            return json.loads(self.registry_path.read_text(encoding="utf-8"))

    def save_registry(self, data: Dict[str, Any]) -> None:
        self.registry_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def get_used_hashes(self) -> set[str]:
        data = self.load_registry()
        return set(item.get("combo_hash") for item in data.get("history", []) if item.get("combo_hash"))

    def get_next_fresh_combo(
        self,
        filter_rel: Optional[str] = None,
        filter_cat: Optional[str] = None,
        filter_rev: Optional[str] = None,
        filter_tone: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Lấy ngẫu nhiên một tổ hợp ma trận CHƯA TỪNG ĐƯỢC SỬ DỤNG.
        Nếu tất cả đã dùng hết (hiếm gặp), reset pool hoặc cảnh báo.
        """
        all_combos = KrTopicMatrix.get_all_combos()
        used_hashes = self.get_used_hashes()

        candidates = []
        for c in all_combos:
            if filter_rel and c["rel_id"] != filter_rel:
                continue
            if filter_cat and c["cat_id"] != filter_cat:
                continue
            if filter_rev and c["rev_id"] != filter_rev:
                continue
            if filter_tone and c["tone_id"] != filter_tone:
                continue
            
            if c["combo_hash"] not in used_hashes:
                candidates.append(c)

        if not candidates:
            logger.warning("⚠️ Không tìm thấy combo hoàn toàn mới với bộ lọc này! Sử dụng ứng viên ít xuất hiện nhất.")
            # Fallback lấy candidate bất kỳ thỏa mãn filter
            candidates = [
                c for c in all_combos
                if (not filter_rel or c["rel_id"] == filter_rel)
                and (not filter_cat or c["cat_id"] == filter_cat)
                and (not filter_rev or c["rev_id"] == filter_rev)
                and (not filter_tone or c["tone_id"] == filter_tone)
            ]

        chosen = random.choice(candidates)
        return KrTopicMatrix.build_combo_seed(
            rel_id=chosen["rel_id"],
            cat_id=chosen["cat_id"],
            rev_id=chosen["rev_id"],
            tone_id=chosen["tone_id"],
        )

    def register_completed_story(self, combo_hash: str, story_metadata: Dict[str, Any]) -> None:
        """Đăng ký kịch bản đã tạo thành công vào Registry."""
        data = self.load_registry()
        history = data.setdefault("history", [])

        # Kiểm tra xem đã tồn tại chưa
        exists = any(h.get("combo_hash") == combo_hash for h in history)
        if not exists:
            record = {
                "combo_hash": combo_hash,
                "registered_at": datetime.now(timezone.utc).isoformat(),
                "slug": story_metadata.get("slug", ""),
                "rel_name": story_metadata.get("rel_name", ""),
                "cat_name": story_metadata.get("cat_name", ""),
                "rev_name": story_metadata.get("rev_name", ""),
                "tone_name": story_metadata.get("tone_name", ""),
                "word_count": story_metadata.get("metrics", {}).get("word_count", 0),
                "estimated_audio_minutes": story_metadata.get("metrics", {}).get("estimated_audio_minutes", 0),
                "output_dir": story_metadata.get("output_dir", ""),
            }
            history.append(record)
            data["used_count"] = len(history)
            self.save_registry(data)
            logger.info(f"✅ Đã ghi nhận combo {combo_hash} vào Topic Registry (Tổng: {data['used_count']}/720)")

    def get_matrix_coverage(self) -> Dict[str, Any]:
        """Báo cáo chỉ số bao phủ ma trận."""
        data = self.load_registry()
        used = len(self.get_used_hashes())
        total = 720
        coverage_pct = round((used / total) * 100, 2)
        return {
            "total_space": total,
            "used_count": used,
            "remaining_count": total - used,
            "coverage_percentage": f"{coverage_pct}%",
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }


# Singleton helper
_registry_instance: Optional[KrTopicRegistry] = None

def get_kr_topic_registry() -> KrTopicRegistry:
    global _registry_instance
    if _registry_instance is None:
        _registry_instance = KrTopicRegistry()
    return _registry_instance
