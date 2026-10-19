# -*- coding: utf-8 -*-
"""
High-Speed Gemini API Story Pipeline for Vietnamese Audio Drama (Sâm Kể Chuyện Style)
Powered by 9Router Gateway (ag/gemini-3.8-flash-medium / ag/gemini-3.8-flash-high).
Dramatic Arc Engine v5.0:
- 5-Phase Dramatic Curve (Hy sinh -> Bạc bẽo -> Chạm đáy & Thức tỉnh -> Bật tăng mãnh liệt -> Nhân quả & Bình yên)
- Sensory Grounding (Chi tiết giác quan đời thực)
- Sharp Dialogue Beats (Thoại đối kháng sắc bén)
- Micro-Cliffhangers từng chương
"""

import sys
import os
import re
import json
import asyncio
import logging
import argparse
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

sys.stdout.reconfigure(encoding="utf-8")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("gemini_vn_story")

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = REPO_ROOT / "src"
SCRIPTS_DIR = REPO_ROOT / "web_vn" / "scripts"

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from auto_yt.gemini_api_engine import GeminiApiEngine, get_gemini_api_engine
from script_audio_parser import heal_speaker_tags


def validate_speaker_tags(text: str) -> dict:
    """Counts [SPEAKER:role_id] tag compliance in a generated script turn."""
    all_tags = re.findall(r'\[SPEAKER(?::([a-z0-9_]*))?\]', text)
    total = len(all_tags)
    with_id = sum(1 for t in all_tags if t)
    empty = total - with_id
    return {
        "total": total,
        "with_id": with_id,
        "empty": empty,
        "empty_ratio": round(empty / total, 3) if total > 0 else 0.0,
        "has_no_tags": total == 0,
    }


class GeminiStoryPipeline:
    """Async 6-Turn Story Pipeline powered by 9Router Gemini API Gateway (Dramatic Arc Engine v5.0)."""

    def __init__(
        self,
        engine: Optional[GeminiApiEngine] = None,
        model: Optional[str] = None,
        timeout: int = 360,
    ):
        self.engine = engine or get_gemini_api_engine()
        self.model = model or self.engine.default_model
        self.timeout = timeout

    async def _generate_turn(
        self,
        prompt: str,
        turn_name: str,
        valid_roles: List[str],
        default_role: str = "nhan_vat_chinh",
        max_tokens: int = 8192,
        temperature: float = 0.75,
    ) -> str:
        """Generates a script turn via 9Router Gemini API with automatic tag healing."""
        logger.info(f"--- [9Router] Generating [{turn_name}] ({len(prompt)} chars prompt) ---")
        t0 = asyncio.get_event_loop().time()

        raw_text, used_model = await self.engine.generate_content(
            prompt=prompt,
            model=self.model,
            temperature=temperature,
            max_output_tokens=max_tokens,
            timeout=self.timeout,
        )
        t1 = asyncio.get_event_loop().time()
        logger.info(f"[{turn_name}] Received {len(raw_text):,} chars ({len(raw_text.split())} words) from [{used_model}] in {t1 - t0:.2f}s")

        # Validate and heal tags
        stats = validate_speaker_tags(raw_text)
        if stats["empty"] > 0:
            logger.info(f"[{turn_name}] Auto-healing {stats['empty']} bare tags...")
            raw_text = heal_speaker_tags(raw_text, default_role=default_role)

        return raw_text.strip()

    async def execute_full_story_pipeline(
        self,
        topic_seed: Dict[str, Any],
        output_dir: Path
    ) -> Dict[str, Any]:
        """Executes the complete 6-turn audio drama storytelling workflow."""
        output_dir.mkdir(parents=True, exist_ok=True)
        results = {}

        default_pronoun = topic_seed.get('default_pronoun', 'Cháu')
        victim_role = topic_seed.get('victim_role', 'nhan_vat_chinh')
        victim_role_name = topic_seed.get('victim_role_name', topic_seed.get('archetype', 'Nhân vật chính / Nạn nhân'))
        antagonist_1_name = topic_seed.get('antagonist_1_name', 'Kẻ phản diện nữ (Mẹ Chồng / Tiểu Tam...)')
        antagonist_2_name = topic_seed.get('antagonist_2_name', 'Kẻ phản diện nam (Chồng / Con trai bất hiếu...)')
        justice_name = topic_seed.get('justice_name', 'Đại diện công lý / Đồng đội cũ')

        ROLE_NU_PHAN_DIEN = "ke_phan_dien_nu"
        ROLE_NAM_PHU = "ke_phan_dien_nam"

        ROLES_T2 = ["bac_sam", "nhan_vat_chinh", ROLE_NU_PHAN_DIEN, ROLE_NAM_PHU]
        ROLES_T3 = ["nhan_vat_chinh", ROLE_NU_PHAN_DIEN, ROLE_NAM_PHU]
        ROLES_T4 = ["nhan_vat_chinh", ROLE_NU_PHAN_DIEN, ROLE_NAM_PHU]
        ROLES_T5 = ["nhan_vat_chinh", "bac_sam"]

        # ----------------------------------------------------
        # TURN 1: Master Blueprint & 10-Chapter Outline (5-Phase Dramatic Curve)
        # ----------------------------------------------------
        t1_file = output_dir / "turn1_blueprint.md"
        if t1_file.exists() and len(t1_file.read_text(encoding="utf-8")) > 500:
            logger.info("Reusing existing Turn 1 Blueprint...")
            turn1_res = t1_file.read_text(encoding="utf-8")
        else:
            t1_prompt = f"""Bạn là chuyên gia biên kịch hàng đầu cho các chương trình truyện audio tâm sự, drama gia đình dài 1h00 đến 1h30 (60 – 90 phút, chuẩn 11.000 – 12.500 từ) trên YouTube (phong cách kênh "Sâm Kể Chuyện").

Dựa trên hạt mầm đề tài mang tính Viral Outlier cao sau:
- Thân phận nhân vật chính: {topic_seed.get('archetype', 'Người mẹ quê nghèo khó')} (Đại từ xưng hô tự sự: "{default_pronoun}")
- Sự hy sinh ban đầu: {topic_seed.get('sacrifice', 'Bán toàn bộ tài sản, trâu cày, mảnh vườn gom tiền cho con')}
- Hành vi áp bức / Bạc bẽo: {topic_seed.get('oppression', 'Bị ngược đãi, bắt ngủ gầm cầu thang, xô ngã đập đầu')}
- Bí mật lật kèo: {topic_seed.get('plot_secret', 'Chứng cứ pháp lý hợp pháp, bằng chứng ghi âm')}
- Cán cân công lý / Trả giá: {topic_seed.get('retribution', 'Cơ quan chức năng vào cuộc bắt quả tang tại trận')}
- Bài học đạo lý: {topic_seed.get('moral', 'Gieo nhân nào gặt quả ấy, kẻ vong ân bội nghĩa ắt nhận quả đắng')}

HÃY LẬP BẢN MASTER BLUEPRINT VÀ DÀN Ý 10 CHƯƠNG CHI TIẾT THEO MÔ HÌNH 5 PHA CẢM XÚC CỰC ĐẠI (DRAMATIC ARC ENGINE v5.0):

YÊU CẦU CẤU TRÚC 5 PHA BẮT BUỘC:
- PHA 1 (Chương 1-2): Khởi đầu & Hy sinh tột cùng (Vắt kiệt mồ hôi, bán trâu cày, bán mảnh vườn cha ông, nhịn ăn sáng).
- PHA 2 (Chương 3-4): Bạc bẽo leo thang & Chà đạp tự trọng (Quà quê bị ném rác, bắt ngủ gầm cầu thang, ăn cơm thừa sau thú cưng, mắng ăn bám).
- PHA 3 (Chương 5-6): CẢM XÚC CHẠM ĐÁY TUYỆT VỌNG & SỰ THỨC TỈNH LẠNH LÙNG (Cướp kỷ vật người thân quá cố, xô ngã đập đầu chảy máu trong đêm rét buốt; nhân vật chính ngừng khóc, tâm can đóng băng, bí mật cài máy ghi âm giăng bẫy ngầm cùng luật sư/công an).
- PHA 4 (Chương 7-8): BẬT TĂNG MÃNH LIỆT (CATHARSIS PAYOFF) (Màn kịch đắc thắng của kẻ ác, tự mồm khai hết tội ác vào máy ghi âm phát trực tiếp -> Hàng chục đèn pha xe cảnh sát bật sáng quét sảnh -> Đạp cửa bắt quả tang tại trận, còng số 8 khóa tay).
- PHA 5 (Chương 9-10): Tòa án nhân quả (Hai kẻ ác quỳ lạy sụp đổ rồi quay sang cắn xé nhau trong phòng thẩm vấn -> Nhân vật chính tìm lại phẩm giá và sự bình yên; Bác Sâm tổng kết đạo lý sâu sắc).

Yêu cầu xuất:
1. TIÊU ĐỀ CHÍNH & 3 TIÊU ĐỀ BIẾN THỂ (Giật gân, có chấm lách kiểm duyệt từ khóa).
2. HỒ SƠ NHÂN VẬT (Gán mã giọng đọc chuẩn 4 ROLES: [SPEAKER:bac_sam], [SPEAKER:nhan_vat_chinh], [SPEAKER:ke_phan_dien_nu], [SPEAKER:ke_phan_dien_nam]).
3. KHUNG 5 HỒI KỊCH BẢN.
4. DÀN Ý 10 CHƯƠNG CHI TIẾT (Mỗi chương khoảng 1.100 - 1.300 từ): Tên chương, Mục tiêu kịch tính, Sự kiện chính xảy ra, Móc câu kết chương (Micro-Cliffhanger)."""
            turn1_res = await self._generate_turn(t1_prompt, "Turn 1: Master Blueprint", ROLES_T2, max_tokens=8192)
            t1_file.write_text(turn1_res, encoding="utf-8")

        results["turn1_blueprint"] = turn1_res

        # ----------------------------------------------------
        # TURN 2: Chapters 1 to 3 (~3,600 words - Pha 1 & Pha 2)
        # ----------------------------------------------------
        t2_file = output_dir / "turn2_chapters_1_3.md"
        if t2_file.exists() and len(t2_file.read_text(encoding="utf-8")) > 500:
            logger.info("Reusing existing Turn 2 Chapters (1-3)...")
            turn2_res = t2_file.read_text(encoding="utf-8")
        else:
            t2_prompt = f"""Dưới đây là Master Blueprint đã duyệt:
{turn1_res}

BÂY GIỜ HÃY VIẾT TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 3 CHƯƠNG ĐẦU TIÊN (Chương 1, Chương 2, Chương 3) với dung lượng cực kỳ đầy đặn khoảng 3.500 - 4.000 từ (~1.200 - 1.350 từ/chương).

KỸ THUẬT VIẾT DRAMA & SENSORY GROUNDING:
- Chi tiết giác quan đời thực: Đôi dép mòn vẹt gót, vết chai sần u máu trên vai, bàn tay nứt nẻ rớm máu, bát cơm chan nước mắm lót dạ, tiếng gót giày cộc cộc trên sàn đá, mùi dưa váng mốc...
- Thoại đối kháng đanh thép: Kẻ phản diện đay nghiến khinh bỉ, con trai lạnh lùng sĩ diện.
- Micro-Cliffhanger cuối mỗi chương (Ch.1 kết bán trâu; Ch.2 kết bằng thạc sĩ thành bức tường ngăn cách; Ch.3 kết nghe lỏm âm mưu chiếm đất).

QUY TẮC BẮT BUỘC:
1. MỖI ĐOẠN VĂN HOẶC CÂU THOẠI BẮT ĐẦU TRÊN MỘT DÒNG MỚI VỚI ĐÚNG TAG:
   [SPEAKER:bac_sam] (CHỈ đầu Chương 1)
   [SPEAKER:nhan_vat_chinh] ({victim_role_name} - xưng "{default_pronoun}")
   [SPEAKER:ke_phan_dien_nu] ({antagonist_1_name})
   [SPEAKER:ke_phan_dien_nam] ({antagonist_2_name})
2. LỜI DẪN / CHIÊM NGHIỆM ĐẦU-CUỐI CHƯƠNG: Luôn dùng [SPEAKER:nhan_vat_chinh].
3. TUYỆT ĐỐI KHÔNG xuất [SPEAKER] trơ trọi, không dùng thẻ cảm xúc nhân tạo.
4. TIÊU ĐỀ: CHƯƠNG 1: ..., CHƯƠNG 2: ..., CHƯƠNG 3: ..."""
            turn2_res = await self._generate_turn(t2_prompt, "Turn 2: Chapters 1-3", ROLES_T2, max_tokens=8192)
            t2_file.write_text(turn2_res, encoding="utf-8")

        results["turn2_chapters_1_3"] = turn2_res

        # ----------------------------------------------------
        # TURN 3: Chapters 4 to 6 (~4,000 words - Pha 2 & Pha 3: CHẠM ĐÁY & THỨC TỈNH)
        # ----------------------------------------------------
        t3_file = output_dir / "turn3_chapters_4_6.md"
        if t3_file.exists() and len(t3_file.read_text(encoding="utf-8")) > 500:
            logger.info("Reusing existing Turn 3 Chapters (4-6)...")
            turn3_res = t3_file.read_text(encoding="utf-8")
        else:
            t3_prompt = f"""Dựa trên Master Blueprint và diễn biến 3 chương trước:
BÂY GIỜ HÃY VIẾT TIẾP TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 3 CHƯƠNG TIẾP THEO (Chương 4, Chương 5, Chương 6) - ĐÂY LÀ ĐOẠN ĐẨY CẢM XÚC CHẠM ĐÁY TUYỆT VỌNG VÀ SỰ THỨC TỈNH LẠNH LÙNG với tổng dung lượng khoảng 3.800 - 4.200 từ (~1.300 - 1.400 từ/chương).

DIỄN BIẾN DRAMA CỰC HẠN TỪNG CHƯƠNG:
- CHƯƠNG 4 (Bạc bẽo cùng cực): Nhân vật chính bị bắt ngủ gầm cầu thang ẩm mốc, ăn cơm thừa sau thú cưng, con trai mắng "đồ ăn bám làm mất mặt".
- CHƯƠNG 5 (CHẠM ĐÁY BI KỊCH): Cơn sốt 40 độ trong đêm rét buốt, bị con dâu cướp đi kỷ vật thiêng liêng cuối cùng của người thân quá cố; xô ngã đập đầu chảy máu lênh láng rồi khóa trái cửa nhốt bỏ mặc trong đêm tối.
- CHƯƠNG 6 (SỰ THỨC TỈNH LẠNH LÙNG - PIVOT POINT): Tỉnh dậy trong bệnh viện, con trai ném 200k tiền xe ôm. Nhân vật chính NGỪNG RƠI NƯỚC MẮT, ánh mắt sắc lạnh, tâm can đóng băng. Bí mật phối hợp với luật sư / công an, bí mật gắn máy ghi âm giăng bẫy ngầm.

QUY TẮC BẮT BUỘC:
- MỖI ĐOẠN VĂN HOẶC CÂU THOẠI BẮT BUỘC BẮT ĐẦU TRÊN MỘT DÒNG MỚI VỚI ĐÚNG TAG:
  [SPEAKER:nhan_vat_chinh], [SPEAKER:ke_phan_dien_nu], [SPEAKER:ke_phan_dien_nam].
- CHUẨN HÓA TTS & GIỌNG ĐỌC:
  + Viết bằng chữ toàn bộ các con số và đơn vị đo (ví dụ: "bốn mươi độ", "hai trăm nghìn", "mười hai mũi khâu", "năm trăm triệu", "hai mươi năm").
  + TUYỆT ĐỐI KHÔNG tạo dòng riêng cho từ tượng thanh như "RẮC!", "CỐP!", "CẠCH!". Hãy miêu tả lồng trong câu tự sự của [SPEAKER:nhan_vat_chinh].
  + Lời dẫn / chiêm nghiệm / tả cảnh luôn dùng [SPEAKER:nhan_vat_chinh].
- TUYỆT ĐỐI KHÔNG xuất [SPEAKER] trơ trọi, không dùng thẻ cảm xúc nhân tạo.
- Tiêu đề: CHƯƠNG 4: ..., CHƯƠNG 5: ..., CHƯƠNG 6: ..."""
            turn3_res = await self._generate_turn(t3_prompt, "Turn 3: Chapters 4-6", ROLES_T3, max_tokens=8192)
            t3_file.write_text(turn3_res, encoding="utf-8")

        results["turn3_chapters_4_6"] = turn3_res

        # ----------------------------------------------------
        # TURN 4: Chapters 7 to 9 (~4,000 words - Pha 4 & Pha 5: BẬT TĂNG MÃNH LIỆT & LẬT KÈO)
        # ----------------------------------------------------
        t4_file = output_dir / "turn4_chapters_7_9.md"
        if t4_file.exists() and len(t4_file.read_text(encoding="utf-8")) > 500:
            logger.info("Reusing existing Turn 4 Chapters (7-9)...")
            turn4_res = t4_file.read_text(encoding="utf-8")
        else:
            t4_prompt = f"""Dưới đây là Dàn ý Blueprint và diễn biến cao trào:
Bí mật lật kèo: {topic_seed.get('plot_secret', 'Chứng cứ pháp lý hợp pháp, máy ghi âm và camera')}
Cán cân công lý: {topic_seed.get('retribution', 'Cơ quan chức năng và công an ập vào bắt quả tang')}

BÂY GIỜ HÃY VIẾT TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 3 CHƯƠNG CAO TRÀO BẬT TĂNG MÃNH LIỆT (Chương 7, Chương 8, Chương 9) với tổng dung lượng khoảng 3.800 - 4.200 từ (~1.300 - 1.400 từ/chương).

DIỄN BIẾN DRAMA BÙNG NỔ TỪNG CHƯƠNG:
- CHƯƠNG 7 (MÀN KỊCH ĐẮC THẮNG CỦA KẺ ÁC): Kẻ ác mở tiệc xa hoa, tưởng mình đã thắng 100%, ép nhân vật chính ký giấy và tự mồm kể hết mọi âm mưu tội ác vào máy ghi âm phát trực tiếp.
- CHƯƠNG 8 (CÚ LẬT KÈO KINH ĐIỂN & BẮT QUẢ TANG - CLIMAX): Nhân vật chính mỉm cười sắc lạnh, chỉ chấm một dấu đen -> Hàng chục đèn pha xe cảnh sát bật sáng quét rực rỡ vào sảnh -> Đạp cửa ùa vào giơ lệnh bắt khẩn cấp, khóa còng số 8 trước sự bẽ bàng, kinh hoàng của toàn thể quan khách.
- CHƯƠNG 9 (TÒA ÁN NHÂN QUẢ & ĐỐI CHẤT PHÒNG THẨM VẤN): Hai kẻ ác quỳ sụp van xin rồi quay sang cắn xé, đổ tội cho nhau; cơ quan kiểm sát tống giam riêng biệt; nhân vật chính thanh thản bước ra đón ánh bình minh.

QUY TẮC BẮT BUỘC:
- TÍNH NHẤT QUÁN BỐI CẢNH (QUAN TRỌNG): Bám sát 100% thân phận nhân vật ({victim_role_name}) và mâu thuẫn gia đình đã thiết lập ở các chương trước. TUYỆT ĐỐI KHÔNG tự ý bịa thêm thân thế mới (như tiểu thư tài phiệt, cổ phần tập đoàn...) nếu không có trong Blueprint ban đầu.
- MỖI ĐOẠN VĂN HOẶC CÂU THOẠI BẮT BUỘC BẮT ĐẦU TRÊN MỘT DÒNG MỚI VỚI ĐÚNG TAG:
  [SPEAKER:nhan_vat_chinh], [SPEAKER:ke_phan_dien_nu], [SPEAKER:ke_phan_dien_nam].
- CHUẨN HÓA TTS & GIỌNG ĐỌC:
  + Viết bằng chữ toàn bộ các con số và đơn vị đo để giọng đọc AI đọc chuẩn xác nhất (ví dụ: "bốn mươi độ", "ba mươi mốt phẩy tám tỷ đồng", "còng số tám", "mười hai mũi khâu", "hai mươi năm").
  + TUYỆT ĐỐI KHÔNG tạo dòng riêng cho từ tượng thanh như "Ù... O...", "RẦM!", "Choang!". Nếu có âm thanh, hãy miêu tả lồng trong câu tự sự của [SPEAKER:nhan_vat_chinh] (ví dụ: "Tiếng còi hú xe cảnh sát vang lên xé toang màn đêm...", "Một tiếng rầm chát chúa vang lên khi cánh cửa bị đạp tung...").
  + Lời miêu tả khung cảnh / hành động bên thứ ba luôn dùng [SPEAKER:nhan_vat_chinh]. [SPEAKER:ke_phan_dien_nam] / [SPEAKER:ke_phan_dien_nu] CHỈ dùng cho câu thoại trực tiếp của nhân vật đó.
- TUYỆT ĐỐI KHÔNG xuất [SPEAKER] trơ trọi, không dùng thẻ cảm xúc nhân tạo.
- Tiêu đề: CHƯƠNG 7: ..., CHƯƠNG 8: ..., CHƯƠNG 9: ..."""
            turn4_res = await self._generate_turn(t4_prompt, "Turn 4: Chapters 7-9", ROLES_T4, max_tokens=8192)
            t4_file.write_text(turn4_res, encoding="utf-8")

        results["turn4_chapters_7_9"] = turn4_res

        # ----------------------------------------------------
        # TURN 5: Chapter 10 & Bác Sâm Outro (~1,500 words - Pha 5)
        # ----------------------------------------------------
        t5_file = output_dir / "turn5_chapter_10_outro.md"
        if t5_file.exists() and len(t5_file.read_text(encoding="utf-8")) > 500:
            logger.info("Reusing existing Turn 5 Chapter 10...")
            turn5_res = t5_file.read_text(encoding="utf-8")
        else:
            t5_prompt = f"""Dựa trên Master Blueprint và kết thúc câu chuyện:
BÂY GIỜ HÃY VIẾT CHƯƠNG 10 VÀ LỜI KẾT BÁC SÂM (HỒI 5 - NHÂN QUẢ PHÂN MINH, BÌNH YÊN & ĐẠO LÝ CUỘC ĐỜI) với dung lượng khoảng 1.300 - 1.600 từ:

QUY TẮC ĐỊNH DẠNG BẮT BUỘC:
1. DÒNG ĐẦU TIÊN CỦA BÀI VIẾT BẮT BUỘC PHẢI LÀ TIÊU ĐỀ CHƯƠNG: CHƯƠNG 10: [Tên tiêu đề theo Blueprint]
2. CẤU TRÚC PHÂN ĐOẠN:
   - CHƯƠNG 10: [SPEAKER:nhan_vat_chinh] Bản án nghiêm minh cho kẻ ác trước tòa. Nhân vật chính tìm lại sự thanh thản, tự do và phẩm giá bên người thân yêu thực sự. Lời đúc kết sâu sắc về giá trị cuộc đời (xưng "{default_pronoun}").
   - LỜI CHÀO KẾT CỦA BÁC SÂM: [SPEAKER:bac_sam] "Quý vị và các bạn thân mến, câu chuyện đêm nay khép lại với thật nhiều dư ba...". Phân tích đạo lý nhân quả, chúc quý khán thính giả an lành, kêu gọi bấm Đăng ký kênh Sâm Kể Chuyện.
3. MỖI ĐOẠN VĂN BẮT ĐẦU TRÊN MỘT DÒNG MỚI VỚI ĐÚNG TAG [SPEAKER:nhan_vat_chinh] HOẶC [SPEAKER:bac_sam].
4. TUYỆT ĐỐI KHÔNG xuất [SPEAKER] trơ trọi, không dùng thẻ cảm xúc nhân tạo."""
            turn5_res = await self._generate_turn(t5_prompt, "Turn 5: Chapter 10 & Outro", ROLES_T5, max_tokens=4096)
            t5_file.write_text(turn5_res, encoding="utf-8")

        results["turn5_chapter_10_outro"] = turn5_res

        # Combine Full Script
        full_script = f"# KỊCH BẢN HOÀN CHỈNH: {topic_seed.get('title', 'Sâm Kể Chuyện')}\n\n"
        full_script += f"## PHẦN 1: HỒI 1 & HỒI 2 (CHƯƠNG 1 - 3)\n\n{turn2_res}\n\n"
        full_script += f"## PHẦN 2: HỒI 3 (CHƯƠNG 4 - 6)\n\n{turn3_res}\n\n"
        full_script += f"## PHẦN 3: HỒI 4 (CHƯƠNG 7 - 9)\n\n{turn4_res}\n\n"
        full_script += f"## PHẦN 4: HỒI 5 (CHƯƠNG 10 & LỜI KẾT)\n\n{turn5_res}\n"
        (output_dir / "full_story_script.md").write_text(full_script, encoding="utf-8")
        results["full_script"] = full_script

        # ----------------------------------------------------
        # TURN 6: SEO Metadata & Viral Thumbnail Prompt
        # ----------------------------------------------------
        t6_file = output_dir / "turn6_metadata_seo.md"
        if t6_file.exists() and len(t6_file.read_text(encoding="utf-8")) > 500:
            logger.info("Reusing existing Turn 6 Metadata...")
            turn6_res = t6_file.read_text(encoding="utf-8")
        else:
            t6_prompt = f"""Dựa trên kịch bản hoàn chỉnh vừa hoàn thành:
Hãy tổng hợp và tạo TRỌN BỘ METADATA SEO YOUTUBE HOÀN CHỈNH cho video kịch bản 1h30 trên:

CẤU TRÚC BẮT BUỘC:
1. TIÊU ĐỀ CHÍNH & 5 TIÊU ĐỀ BIẾN THỂ A/B TEST (Chuẩn giật gân, có chấm lách kiểm duyệt từ khóa như: Đ.ại T.á, N.ữ T.rung Ú.y, B.ắt, T.ội Á.c, C.hết L.ặng, N.hân T.ình...).
2. MÔ TẢ VIDEO YOUTUBE (Description 6 phần chuẩn SEO):
   - Phần 1: Hook mở đầu 3 dòng kịch tính tột độ khơi gợi tò mò.
   - Phần 2: Giới thiệu câu chuyện sâu sắc.
   - Phần 3: Mục lục Chapters đầy đủ 10 chương kèm mốc thời gian (00:00 Chương 1, ...).
   - Phần 4: Kêu gọi hành động (CTA: Like, Share, Đăng ký kênh Sâm Kể Chuyện).
   - Phần 5: Đoạn MIỄN TRỪ TRÁCH NHIỆM (Khẳng định truyện hư cấu nhân văn, nhân vật tưởng tượng, giọng đọc AI để tuân thủ 100% chính sách YouTube).
   - Phần 6: 10 Hashtags chuẩn (#samkechuyen #tamsucungvansam #truyenaudio #truyentamly...).
3. DANH SÁCH 20 TAGS SEO YOUTUBE (Dạng danh sách phân cách dấu phẩy để copy dán vào YouTube Studio).
4. PROMPT TẠO ẢNH THUMBNAIL (Bằng tiếng Anh cho Midjourney/Flux mô tả chi tiết nhân vật chính mặc sắc phục uy nghiêm hoặc gương mặt phụ nữ khắc khổ đầy xúc động, bố cục kịch tính tương phản cao)."""
            turn6_res = await self._generate_turn(t6_prompt, "Turn 6: SEO Metadata", ["seo_metadata"], max_tokens=4096)
            t6_file.write_text(turn6_res, encoding="utf-8")

        results["turn6_metadata"] = turn6_res

        total_words = len(full_script.split())
        logger.info(f"=== [9Router API] FULL STORY PIPELINE COMPLETED! ===")
        logger.info(f"Total script words: {total_words:,} words (~{total_words/125/60:.1f} hours audio • 1h00-1h30 target)")
        logger.info(f"Saved artifacts to: {output_dir}")

        return results


async def main():
    parser = argparse.ArgumentParser(description="9Router Gemini Vietnamese Story Pipeline")
    parser.add_argument("--story-id", type=str, help="Story ID to process")
    parser.add_argument("--model", type=str, default=None, help="Custom model override")
    args = parser.parse_args()

    out_dir = REPO_ROOT / "web_vn" / "output" / "story_test_9router_01"

    if args.story_id:
        folder_name = args.story_id if args.story_id.startswith("story_") else f"story_{args.story_id}"
        out_dir = REPO_ROOT / "web_vn" / "output" / folder_name
        seed_file = out_dir / "topic_seed.json"
        if seed_file.exists():
            topic = json.loads(seed_file.read_text(encoding="utf-8"))
        else:
            logger.error(f"Topic seed file not found: {seed_file}")
            sys.exit(1)
    else:
        topic = {
            "title": "Bắt Mẹ Đẻ Đóng Giả Người Giúp Việc Để Đãi Tiệc Nhà Vợ – Giờ G Đại Gia Nghìn Tỷ Quỳ Lạy Mẹ Giữa Sảnh | Sâm Kể Chuyện",
            "archetype": "Mẹ Quê Tần Tảo Gánh Rong",
            "sacrifice": "Ăn cơm độn khoai sắn suốt 20 năm để con trai có tiền mua quần áo đẹp, ăn học thành tài",
            "oppression": "Con trai sợ mất mặt với nhà vợ giàu có, bắt mẹ già đóng giả người giúp việc làm tiệc đãi khách",
            "plot_secret": "Người mẹ từng cưu mang Chủ tịch tập đoàn lớn - người luôn coi bà như mẹ ruột",
            "retribution": "Chủ tịch tập đoàn ập vào bữa tiệc, quỳ sụp xuống gọi Mẹ trước sự chết lặng của con trai và thông gia",
            "moral": "Bách thiện hiếu vi tiên - Kẻ bất hiếu với đấng sinh thành thì dẫu giàu sang cũng có ngày sụp đổ"
        }

    pipeline = GeminiStoryPipeline(model=args.model)
    await pipeline.execute_full_story_pipeline(topic, out_dir)


if __name__ == '__main__':
    asyncio.run(main())
