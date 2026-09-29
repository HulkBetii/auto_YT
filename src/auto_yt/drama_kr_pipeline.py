# -*- coding: utf-8 -*-
"""
DRAMA HÀN STORY PIPELINE (9ROUTER GEMINI API POWERED)
High-octane K-Drama / K-Story storytelling pipeline for YouTube drama audio channels.
Generates full 10-chapter episodic scripts (1h00 - 1h30 target, 11,000 - 13,000 words)
using multi-turn prompting via 9Router Gemini API Gateway.
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

logger = logging.getLogger("DramaKrPipeline")

OUTPUT_DIR = PROJECT_ROOT / "output_drama_kr"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 5 Cụm chủ đề Drama Hàn Quốc kịch tính
TOPIC_CLUSTERS = {
    "cluster_chaebol_con_dau": {
        "id": "cluster_chaebol_con_dau",
        "name": "Mẹ chồng gia tộc Chaebol vs Con dâu nghèo phục thù",
        "archetypes": ["me_chong_chaebol", "con_dau_kien_cuong", "nguoi_dan", "chong_nhu_nhuoc", "tieu_tam_thu_ky"],
        "default_voice_roles": {
            "nguoi_dan": "nguoi_dan",
            "con_dau": "nu_chinh",
            "me_chong": "me_chong",
            "chong": "nguoi_chong",
            "tieu_tam": "tieu_tam",
        },
        "description": "Cuộc hôn nhân đầy toan tính trong giới thượng lưu Hàn Quốc, con dâu bị áp bức tàn nhẫn nhưng âm thầm thu thập chứng cứ lật đổ đế chế gia đình chồng.",
    },
    "cluster_tieu_tam_cong_so": {
        "id": "cluster_tieu_tam_cong_so",
        "name": "Trừng phạt chồng bội bạc & Tiểu tam tập đoàn",
        "archetypes": ["nu_chinh_tai_nang", "chong_phan_boi", "tieu_tam_muu_mo", "nguoi_dan", "chu_tich_tap_doan"],
        "default_voice_roles": {
            "nguoi_dan": "nguoi_dan",
            "nu_chinh": "nu_chinh",
            "chong": "nguoi_chong",
            "tieu_tam": "tieu_tam",
        },
        "description": "Người vợ hi sinh sự nghiệp cho chồng thăng tiến tại tập đoàn, phát hiện chồng ngoại tình với cấp dưới và lập kế hoạch tước đoạt toàn bộ cổ phần lẫn danh dự.",
    },
    "cluster_hoc_duong_knetizen": {
        "id": "cluster_hoc_duong_knetizen",
        "name": "Bóc phốt bạo lực học đường & Quả báo K-Netizen",
        "archetypes": ["nan_nhan_tro_lai", "ke_bat_nat_ngoi_sao", "nguoi_dan", "luat_su_chinh_nghia"],
        "default_voice_roles": {
            "nguoi_dan": "nguoi_dan",
            "nu_chinh": "nu_chinh",
            "ke_phan_dien": "tieu_tam",
            "luat_su": "nguoi_chong",
        },
        "description": "Nạn nhân từng bị bắt nạt tàn nhẫn thời trung học tái xuất sau 10 năm, dùng sức mạnh truyền thông mạng xã hội K-Netizen và chứng cứ pháp lý để kẻ thủ ác phải trả giá trước công chúng.",
    },
    "cluster_thua_ke_gia_toc": {
        "id": "cluster_thua_ke_gia_toc",
        "name": "Cuộc chiến tranh đoạt quyền thừa kế gia tộc",
        "archetypes": ["con_truong_tham_lam", "con_thu_ban_linh", "nguoi_dan", "luat_su_gia_toc", "chu_tich_lao_thanh"],
        "default_voice_roles": {
            "nguoi_dan": "nguoi_dan",
            "con_thu": "nu_chinh",
            "con_truong": "nguoi_chong",
            "chu_tich": "me_chong",
        },
        "description": "Trận chiến ngầm không khoan nhượng giữa các thế hệ người thừa kế, phơi bày những âm mưu hãm hại và bí mật kinh hoàng được che giấu sau cánh cổng dinh thự.",
    },
}


def validate_speaker_tags(text: str) -> Dict[str, Any]:
    """Kiểm tra tính hợp lệ của các tag nhân vật [SPEAKER:role_id]."""
    all_tags = re.findall(r'\[SPEAKER(?::([a-z0-9_]*))?\]', text, re.IGNORECASE)
    total = len(all_tags)
    with_id = sum(1 for t in all_tags if t and t.strip())
    empty = total - with_id
    return {
        "total": total,
        "with_id": with_id,
        "empty": empty,
        "empty_ratio": round(empty / total, 3) if total > 0 else 0.0,
        "has_no_tags": total == 0,
    }


def heal_speaker_tags(text: str, default_role: str = "nguoi_dan") -> str:
    """Tự động chuẩn hóa và sửa các tag [SPEAKER] thiếu role_id."""
    def _repl(match):
        role = match.group(1)
        if not role or not role.strip():
            return f"[SPEAKER:{default_role}]"
        return f"[SPEAKER:{role.strip().lower()}]"

    healed = re.sub(r'\[SPEAKER(?::([a-zA-Z0-9_]*))?\]', _repl, text)
    return healed


class DramaKrPipeline:
    """
    Pipeline điều phối tạo kịch bản Drama Hàn Quốc 7-Turn qua 9Router Gateway.
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
        topic_seed: Dict[str, Any],
        story_slug: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Thực hiện toàn bộ quy trình 7-Turn sinh kịch bản Drama Hàn.
        """
        cluster_id = topic_seed.get("cluster_id", "cluster_chaebol_con_dau")
        cluster_info = TOPIC_CLUSTERS.get(cluster_id, TOPIC_CLUSTERS["cluster_chaebol_con_dau"])
        
        slug = story_slug or f"drama_kr_{topic_seed.get('id', 'sample')}_{int(asyncio.get_event_loop().time())}"
        story_dir = self.output_base_dir / slug
        story_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"🚀 Bắt đầu tạo kịch bản Drama Hàn: {slug} (Cluster: {cluster_info['name']})")

        # Lưu Topic Seed
        (story_dir / "topic_seed.json").write_text(json.dumps(topic_seed, ensure_ascii=False, indent=2), encoding="utf-8")

        conversation_history: List[Dict[str, str]] = []

        # TURN 1: Master Blueprint
        logger.info("📝 [Turn 1/7] Đang tạo Master Blueprint...")
        prompt_t1 = self._build_turn1_prompt(topic_seed, cluster_info)
        t1_response, _ = await self.engine.generate_content(prompt=prompt_t1, model=self.model, temperature=0.7)
        (story_dir / "turn1_blueprint.md").write_text(t1_response, encoding="utf-8")
        conversation_history.append({"turn": "turn1", "prompt": prompt_t1, "response": t1_response})

        # TURN 2: Detailed 10-Chapter Outline
        logger.info("📋 [Turn 2/7] Đang lập dàn ý 10 Hồi (Detailed Outline)...")
        prompt_t2 = self._build_turn2_prompt(t1_response)
        t2_response, _ = await self.engine.generate_content(
            prompt=f"Dưới đây là Blueprint đã duyệt:\n{t1_response}\n\n{prompt_t2}",
            model=self.model,
            temperature=0.7,
        )
        (story_dir / "chapters_outline.json").write_text(t2_response, encoding="utf-8")
        conversation_history.append({"turn": "turn2", "prompt": prompt_t2, "response": t2_response})

        # TURN 3: Viết Hồi 1 - 3
        logger.info("🎬 [Turn 3/7] Đang viết Hồi 1, 2, 3 (Khởi đầu xung đột & áp bức)...")
        prompt_t3 = self._build_turn3_prompt(t1_response, t2_response)
        t3_response, _ = await self.engine.generate_content(prompt=prompt_t3, model=self.model, temperature=0.75)
        t3_healed = heal_speaker_tags(t3_response)
        (story_dir / "turn2_chapters_1_3.md").write_text(t3_healed, encoding="utf-8")

        # TURN 4: Viết Hồi 4 - 6
        logger.info("⚡ [Turn 4/7] Đang viết Hồi 4, 5, 6 (Cao trào, khám phá bí mật & liên minh)...")
        prompt_t4 = self._build_turn4_prompt(t1_response, t3_healed)
        t4_response, _ = await self.engine.generate_content(prompt=prompt_t4, model=self.model, temperature=0.75)
        t4_healed = heal_speaker_tags(t4_response)
        (story_dir / "turn3_chapters_4_6.md").write_text(t4_healed, encoding="utf-8")

        # TURN 5: Viết Hồi 7 - 9
        logger.info("💥 [Turn 5/7] Đang viết Hồi 7, 8, 9 (Phản công đỉnh điểm & quả báo nhãn tiền)...")
        prompt_t5 = self._build_turn5_prompt(t1_response, t4_healed)
        t5_response, _ = await self.engine.generate_content(prompt=prompt_t5, model=self.model, temperature=0.75)
        t5_healed = heal_speaker_tags(t5_response)
        (story_dir / "turn4_chapters_7_9.md").write_text(t5_healed, encoding="utf-8")

        # TURN 6: Viết Hồi 10 & Epilogue
        logger.info("🏆 [Turn 6/7] Đang viết Hồi 10 & Kết luận đạo lý nhân sinh...")
        prompt_t6 = self._build_turn6_prompt(t1_response, t5_healed)
        t6_response, _ = await self.engine.generate_content(prompt=prompt_t6, model=self.model, temperature=0.7)
        t6_healed = heal_speaker_tags(t6_response)
        (story_dir / "turn5_chapter_10_outro.md").write_text(t6_healed, encoding="utf-8")

        # TURN 7: SEO & Metadata Package
        logger.info("🏷️ [Turn 7/7] Đang tạo gói SEO Metadata & Thumbnail Prompts...")
        prompt_t7 = self._build_turn7_prompt(t1_response, topic_seed)
        t7_response, _ = await self.engine.generate_content(prompt=prompt_t7, model=self.model, temperature=0.7)
        (story_dir / "turn6_metadata_seo.md").write_text(t7_response, encoding="utf-8")

        # Hợp nhất toàn bộ kịch bản
        full_script = f"{t3_healed}\n\n{t4_healed}\n\n{t5_healed}\n\n{t6_healed}"
        (story_dir / "full_story_script.md").write_text(full_script, encoding="utf-8")

        # Đếm từ và phân tích tag
        word_count = len(full_script.split())
        tag_stats = validate_speaker_tags(full_script)

        summary_result = {
            "slug": slug,
            "status": "completed",
            "output_dir": str(story_dir),
            "word_count": word_count,
            "tag_stats": tag_stats,
            "model_used": self.model,
        }

        (story_dir / "pipeline_state.json").write_text(json.dumps(summary_result, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(f"✨ HOÀN TẤT TẠO KỊCH BẢN DRAMA HÀN: {slug} ({word_count} từ, {tag_stats['total']} speaker tags)")
        return summary_result

    def _build_turn1_prompt(self, seed: Dict[str, Any], cluster: Dict[str, Any]) -> str:
        return f"""
BẠN LÀ BIÊN KỊCH HÀNG ĐẦU VỀ DRAMA HÀN QUỐC (K-DRAMA REVENGE / SOCIAL CONFLICT).
Hãy xây dựng MASTER BLUEPRINT cho bộ phim truyền thanh kịch tính dài 10 hồi.

CHỦ ĐỀ & BỐI CẢNH:
- Cụm đề tài: {cluster['name']}
- Tóm tắt ý tưởng: {seed.get('summary', cluster['description'])}
- Tiêu đề dự kiến: {seed.get('title', 'Kế Hoạch Phục Thù Của Nàng Dâu')}

YÊU CẦU BẮT BUỘC TRONG BLUEPRINT:
1. DANH SÁCH NHÂN VẬT & MÃ SPEAKER ĐỊNH DANH (Dùng cho TTS đa vai):
   - [SPEAKER:nguoi_dan]: Người dẫn chuyện điềm tĩnh, sắc lạnh, tạo bầu không khí ngột ngạt chuẩn K-Drama.
   - [SPEAKER:nu_chinh]: Nữ chính kiên cường, sắc sảo, ngoài mặt nhẫn nhịn nhưng mưu sâu kế độc.
   - [SPEAKER:me_chong]: Mẹ chồng tài phiệt hách dịch, cay nghiệt, coi thường kẻ nghèo.
   - [SPEAKER:chong]: Người chồng nhu nhược, đạo đức giả hoặc phản bội.
   - [SPEAKER:tieu_tam]: Kẻ thứ ba toan tính, tham vọng trèo cao.

2. CẤU TRÚC 5 HỒI CĂNG THẲNG:
   - Mở màn (Hồi 1-2): Cú tát xã hội, sự sỉ nhục cay đắng, bi kịch lên tới đỉnh điểm.
   - Leo thang (Hồi 3-5): Âm thầm bày trận, liên minh ngầm, các bí mật đen tối dần lộ diện.
   - Bước ngoặt (Hồi 6-7): Đối đầu trực diện, bẫy lồng bẫy, kẻ phản diện tưởng chừng nắm chắc chiến thắng.
   - Đòn chí mạng & Quả báo (Hồi 8-9): Bóc trần trước công chúng, tài sản bị phong tỏa, kẻ ác sụp đổ hoàn toàn.
   - Hồi kết & Đạo lý (Hồi 10): Sự thanh thản của người chiến thắng và bài học nhân quả sâu sắc.

XUẤT RA DƯỚI ĐỊNH DẠNG MARKDOWN CẤU TRÚC RÕ RÀNG.
"""

    def _build_turn2_prompt(self, blueprint_text: str) -> str:
        return """
Dựa vào Master Blueprint trên, hãy thiết kế CHI TIẾT DÀN Ý 10 HỒI (Chapters Outline).
Mỗi hồi cần nêu rõ:
- Tên hồi (Ví dụ: Hồi 1: Cơn Thịnh Nộ Của Gia Tộc)
- Mục tiêu kịch tính chính (Main Dramatic Goal)
- Các nhân vật xuất hiện & lời thoại mấu chốt (Key Dialogue Line)
- Điểm chốt hạ cuối hồi (Cliffhanger / Hook sang hồi sau)
"""

    def _build_turn3_prompt(self, blueprint: str, outline: str) -> str:
        return f"""
DỰA VÀO BLUEPRINT VÀ DÀN Ý, HÃY VIẾT TOÀN VĂN KỊCH BẢN CHI TIẾT CHO:
👉 HỒI 1, HỒI 2, HỒI 3 (Dung lượng yêu cầu: ~3,000 - 3,500 từ).

QUY TẮC ĐỊNH DẠNG TUYỆT ĐỐI BẮT BUỘC:
1. MỌI LỜI DẪN CHUYỆN HOẶC THOẠI ĐỀU PHẢI CÓ THẺ SPEAKER ĐẦU ĐOẠN:
   [SPEAKER:nguoi_dan] ...
   [SPEAKER:me_chong] ...
   [SPEAKER:nu_chinh] ...
   [SPEAKER:chong] ...
2. TUYỆT ĐỐI KHÔNG DÙNG THẺ [SPEAKER] TRỐNG KHÔNG CÓ TÊN NHÂN VẬT.
3. Lời thoại phải đanh thép, đối đáp gay cấn, miêu tả chi tiết ánh mắt, hành động, không khí xa hoa nhưng lạnh lẽo của giới thượng lưu Seoul.
"""

    def _build_turn4_prompt(self, blueprint: str, prev_turns: str) -> str:
        return f"""
TIẾP TỤC DÒNG CHẢY KỊCH TÍNH, HÃY VIẾT TOÀN VĂN CHI TIẾT CHO:
👉 HỒI 4, HỒI 5, HỒI 6 (Dung lượng yêu cầu: ~3,000 - 3,500 từ).

QUY TẮC BẮT BUỘC:
1. Sử dụng chính xác thẻ [SPEAKER:nguoi_dan], [SPEAKER:nu_chinh], [SPEAKER:me_chong], [SPEAKER:chong], [SPEAKER:tieu_tam].
2. Tình tiết: Nữ chính bắt đầu kích hoạt bẫy ngầm, thu thập băng ghi âm, giải mã di chúc, đối đầu nghẹt thở.
"""

    def _build_turn5_prompt(self, blueprint: str, prev_turns: str) -> str:
        return f"""
TIẾP TỤC DÒNG CHẢY KỊCH TÍNH, HÃY VIẾT TOÀN VĂN CHI TIẾT CHO:
👉 HỒI 7, HỒI 8, HỒI 9 (Dung lượng yêu cầu: ~3,000 - 3,500 từ).

QUY TẮC BẮT BUỘC:
1. Đảm bảo 100% dòng thoại có thẻ [SPEAKER:role_id].
2. Tình tiết: Phản công rực lửa! Họp báo chấn động, cảnh sát ập vào dinh thự, kẻ ác hoảng loạn lộ bộ mặt thật.
"""

    def _build_turn6_prompt(self, blueprint: str, prev_turns: str) -> str:
        return f"""
HÃY VIẾT TOÀN VĂN HỒI KẾT VÀ OUTRO:
👉 HỒI 10 & LỜI BỘC BẠCH NHÂN SINH (Dung lượng yêu cầu: ~1,500 - 2,000 từ).

QUY TẮC BẮT BUỘC:
1. [SPEAKER:nguoi_dan] đúc kết lại kết cục của từng nhân vật (kẻ vào tù, người trắng tay, nữ chính lấy lại công bằng).
2. Đoạn Outro triết lý sâu sắc về tình người, lòng tham và luật nhân quả trong cuộc sống hiện đại.
"""

    def _build_turn7_prompt(self, blueprint: str, seed: Dict[str, Any]) -> str:
        return """
HÃY TẠO GÓI SEO METADATA TOÀN DIỆN CHO YOUTUBE:
1. 3 Tiêu đề giật gân, CTR cao (kèm icon và format chuẩn Drama Hàn).
2. 2 Prompt tạo ảnh bìa Thumbnail (Midjourney / AI format) miêu tả thần thái nhân vật.
3. Bản mô tả video YouTube (Description) chuẩn SEO có hook 3 dòng đầu.
4. Danh sách 30 Tags SEO YouTube thị trường Việt Nam & K-Drama.
5. Danh sách Chapters timestamps dự kiến (10 Hồi).
"""
