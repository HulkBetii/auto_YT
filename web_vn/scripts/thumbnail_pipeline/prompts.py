# -*- coding: utf-8 -*-
"""
CENTRALIZED PROMPT TEMPLATES FOR 10-STAGE THUMBNAIL PIPELINE
Channel: 'Sâm Kể Chuyện' (web_vn)
Versions:
- single_story_integrity_v1
- thumbnail_dna_v1
- thumbnail_concepts_v1
- thumbnail_hooks_typography_v1
- thumbnail_selection_v1
- thumbnail_scene_only_v1 (Deterministic Layered Compositing)
- thumbnail_prompt_one_shot_experimental_v1 (Legacy/Experimental)
- thumbnail_dual_qc_v1
"""

PROMPT_VERSIONS = {
    "single_story_integrity": "single_story_integrity_v1",
    "thumbnail_dna": "thumbnail_dna_v1",
    "thumbnail_concepts": "thumbnail_concepts_v1",
    "thumbnail_hooks": "thumbnail_hooks_typography_v1",
    "thumbnail_selection": "thumbnail_selection_v1",
    "thumbnail_scene_only": "thumbnail_scene_only_v1",
    "thumbnail_prompt": "thumbnail_scene_only_v1",
    "thumbnail_qc": "thumbnail_dual_qc_v1",
}

SINGLE_STORY_INTEGRITY_V1 = """Bạn là Chuyên gia Thẩm định Kịch bản Video YouTube & Giám đốc Nghệ thuật Thumbnail.
NGUYÊN TẮC CỐT LÕI: Toàn bộ phụ đề/kịch bản được cung cấp là MỘT CÂU CHUYỆN HOÀN CHỈNH DUY NHẤT.
Tuyệt đối KHÔNG chia tách kịch bản thành nhiều câu chuyện riêng biệt, KHÔNG bỏ rơi bất kỳ phần nào của câu chuyện.

Nhiệm vụ của bạn: Đọc toàn bộ kịch bản và thực hiện kiểm tra tính nhất quán nội tại (Single-Story Integrity Check):
1. Danh sách nhân vật (Characters): Tên chuẩn (canonical_name), tên gọi khác/biệt danh (aliases), vai trò (role), các mối quan hệ (relationships), độ tuổi nếu có (age_if_known), giới tính nếu có (gender_if_known).
2. Tóm tắt diễn biến theo dòng thời gian (timeline_summary): Tóm lược các mốc sự kiện chính từ đầu, giữa, cao trào đến kết thúc.
3. Phát hiện bất thường nội tại (Internal Inconsistencies Check):
   - Đổi tên nhân vật ngẫu nhiên (ví dụ đầu truyện gọi Tuấn, giữa truyện nhầm thành Hùng).
   - Mâu thuẫn về vai vế/quan hệ họ hàng.
   - Mâu thuẫn về độ tuổi hoặc giới tính.
   - Mâu thuẫn mốc thời gian hoặc sự kiện.
   - Mức độ cảnh báo (integrity_status): "clean" (hoàn hảo) | "minor_warning" (sai sót nhỏ tên/tuổi) | "major_warning" (mâu thuẫn tình tiết lớn).
   *LƯU Ý: Các cảnh báo chỉ mang tính thông tin tham khảo, không làm thay đổi hay cắt xén nội dung truyện.*
4. Tóm tắt cốt lõi câu chuyện (story_summary): Tóm tắt ngắn gọn 100-150 từ toàn bộ diễn biến và thông điệp.

BẮT BUỘC TRẢ VỀ DUY NHẤT ĐỊNH DẠNG JSON THEO SCHEMA:
```json
{
  "integrity_status": "clean",
  "characters": [
    {
      "canonical_name": "Bà Lệ",
      "aliases": ["Mẹ già", "Bà mẹ quê"],
      "role": "Mẹ già bị con cái hắt hủi",
      "relationships": ["Mẹ ruột Tuấn", "Mẹ chồng Thảo"],
      "age_if_known": 70,
      "gender_if_known": "female"
    }
  ],
  "timeline_summary": [
    "Bà Lệ từ quê mang quà và nhẫn cưới gia bảo lên thăm con trai",
    "Con dâu và con trai khinh thường, bẻ tay cướp nhẫn cưới và ném 200 nghìn xua đuổi",
    "Bà mẹ gục ngã dưới chân cầu thang trong đau đớn và uất nghẹn",
    "Sự thật về tình mẫu tử và cái kết thức tỉnh"
  ],
  "warnings": [],
  "story_summary": "Người mẹ già nghèo khó mang kỷ vật thiêng liêng lên trao cho con trai nhưng bị con dâu tham lam và đứa con trai bất hiếu đối xử tàn nhẫn, cướp nhẫn cưới rồi xua đuổi như kẻ ăn xin."
}
```
"""

THUMBNAIL_DNA_V1 = """Bạn là Giám đốc Sáng tạo Thumbnail YouTube & Chuyên gia Tâm lý Khán giả Việt Nam.
Nhiệm vụ của bạn: Trích xuất "HẠT NHÂN THỊ GIÁC & CẢM XÚC" (Thumbnail DNA) từ TOÀN BỘ CÂU CHUYỆN để tạo ra Thumbnail YouTube có tỷ lệ nhấp chuột (CTR) bùng nổ.

CÁC YẾU TỐ BẮT BUỘC TRÍCH XUẤT:
1. story_core: Bản chất cốt lõi của câu chuyện (1 câu ngắn gọn).
2. victim: Nạn nhân gây đồng cảm mạnh mẽ nhất (description, visual_traits).
3. aggressor: Kẻ gây hấn, phản bội hoặc tạo phẫn nộ đạo đức (description, visual_traits).
4. relationship: Mối quan hệ giữa nạn nhân và kẻ phản diện (Mẹ chồng - Nàng dâu, Bố - Con ruột, Vợ - Chồng phản bội...).
5. desire: Động cơ thèm khát của kẻ phản diện (chọn từ: money | inheritance | property | status | relationship | revenge | secret | control).
6. main_hook_type: Loại đòn bẩy tâm lý chính (ví dụ: bóc trần sự bất hiếu, bí mật tài sản, sự phản bội cay đắng).
7. high_emotion_moment: Khoảnh khắc bùng nổ cảm xúc có thể hiểu ngay trong 0.5 - 1 giây.
   *LƯU Ý: KHÔNG nhất thiết phải dùng đoạn kết. Một khoảnh khắc ngay TRƯỚC cú twist thường tạo khoảng trống tò mò (curiosity gap) mạnh mẽ hơn.*
8. key_prop: 1 vật thể cụ thể đại diện cho mâu thuẫn (Sổ đỏ, Di chúc, Nhẫn cưới dính máu, Tờ tiền rách, Gói thuốc, Bát cháo...).
9. mystery_element: Yếu tố bí ẩn chưa có lời giải đáp.
10. visual_question: Câu hỏi thị giác người xem sẽ tự hỏi ngay khi nhìn lướt qua thumbnail.
11. what_not_to_reveal: Danh sách các điều TUYỆT ĐỐI CẤM LỘ (cú twist lật kèo cuối cùng, danh tính bí mật, cái kết).
12. setting: Không gian bối cảnh kịch tính (Phòng khách biệt thự, gầm cầu thang, cổng nhà mưa rét, nhà cấp bốn...).
13. vietnamese_context: Các chi tiết văn hóa, đời sống đặc trưng của người Việt (áo nâu bạc màu, dép tổ ong, ấm chén Bát Tràng...).

TRẢ VỀ DUY NHẤT JSON THEO SCHEMA:
```json
{
  "story_core": "Mẹ già mang nhẫn gia bảo lên cho con bị con dâu bẻ tay cướp đoạt và xua đuổi",
  "victim": {
    "description": "Người mẹ già ngoài 70 tuổi từ quê lên, áo nâu sờn cũ, gương mặt khắc khổ đầy nếp nhăn, ngấn lệ uất ức",
    "visual_traits": "Tóc bạc búi lỏng, bàn tay gầy gò nhăn nheo ôm ngón tay đau, quần áo bạc màu"
  },
  "aggressor": {
    "description": "Cô con dâu thành thị sang chảnh trơ tráo kết hợp cùng con trai vô cảm",
    "visual_traits": "Váy đỏ dạ hội đắt tiền, mặt sắc lạnh, nụ cười nhếch mép đắc thắng, tay đeo nhẫn vàng vừa cướp"
  },
  "relationship": "Mẹ chồng quê nghèo và con dâu thành thị bất hiếu",
  "desire": "property",
  "main_hook_type": "bóc trần tội ác bất hiếu & cướp đoạt kỷ vật",
  "high_emotion_moment": "Con dâu ngạo nghễ ngắm chiếc nhẫn vàng vừa cướp, con trai vung tay ném tờ tiền xua đuổi mẹ già đang gục ngã dưới chân cầu thang",
  "key_prop": "Chiếc nhẫn cưới vàng dính máu và tờ tiền 200 nghìn rơi trên nền đất",
  "mystery_element": "Ý nghĩa thật sự của chiếc nhẫn gia bảo và bí mật gia đình",
  "visual_question": "Tại sao con dâu lại nhẫn tâm cướp nhẫn cưới và đuổi mẹ già nghèo khó?",
  "what_not_to_reveal": ["Cái kết quả báo của cặp vợ chồng", "Bí mật quyền thừa kế thực sự"],
  "setting": "Dưới chân cầu thang biệt thự sang trọng, tương phản giữa đèn chùm lộng lẫy và góc tối ẩm thấp",
  "vietnamese_context": ["Nhẫn cưới vàng ta truyền thống", "Tờ tiền Việt Nam", "Trang phục người già thôn quê"]
}
```
"""

THUMBNAIL_CONCEPTS_V1 = """Bạn là Đạo diễn Nghệ thuật & Chuyên gia Tối ưu Hóa CTR YouTube.
Nhiệm vụ của bạn: Từ Thumbnail DNA, hãy thiết kế ĐÚNG 3 CONCEPT THUMBNAIL HOÀN TOÀN KHÁC BIỆT VỀ HƯỚNG TIẾP CẬN (A, B, C).

QUY TẮC BẮT BUỘC:
1. BA HƯỚNG TIẾP CẬN RIÊNG BIỆT:
   - CONCEPT A (CONFRONTATION - Đối đầu & Áp bức): Tập trung vào áp lực, tranh cãi, chỉ tay xua đuổi, bắt ký giấy, cướp đoạt trực diện.
   - CONCEPT B (MYSTERY / EVIDENCE - Bí ẩn & Vật chứng): Tập trung vào vật chứng đáng ngờ, manh mối bí mật, sự phát hiện chấn động.
   - CONCEPT C (EMOTIONAL SHOCK - Đau đớn & Nỗi đau câm lặng): Tập trung vào nạn nhân gục ngã, sự bàng hoàng, nước mắt, sự sụp đổ niềm tin.
2. GIỚI HẠN NHÂN VẬT (Character Count Rule):
   - Mặc định tối đa: 1 HOST + 2 NHÂN VẬT TRUYỆN (Nhân vật thứ 3 chỉ cho phép khi bắt buộc phải có để hiểu xung đột).
   - Tuyệt đối tránh: Host + 4-5 khuôn mặt to gây rối loạn thị giác trên mobile.
3. BỐ CỤC ĐỘNG (Dynamic Composition & Layout):
   - text_zone: Khai báo linh hoạt một trong các vùng: "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-center".
   - host_position: "left" | "right".
   - host_gaze_direction: Hướng ánh mắt của Host nhìn về phía xung đột.
   - attention_marker: Cung cấp nếu cần làm nổi bật vật chứng nhỏ (type: "arrow" | "circle" | "zoom" | "none", target: "nhẫn cưới" / "sổ đỏ"...).

TRẢ VỀ DUY NHẤT JSON THEO SCHEMA:
```json
{
  "concepts": [
    {
      "concept_id": "A",
      "concept_type": "confrontation",
      "concept_name": "Đối đầu trực diện – Cướp nhẫn đuổi mẹ",
      "story_moment": "Con dâu giơ cao chiếc nhẫn vàng vừa cướp, con trai ném tiền xua đuổi mẹ già quỵ ngã",
      "visual_question": "Vì sao con dâu lại cướp nhẫn cưới của mẹ chồng rồi đuổi đi?",
      "main_subject": "Bà Lệ ngồi bệt dưới gầm cầu thang, một tay ôm ngón tay sưng đau, ngước nhìn lên uất ức",
      "secondary_subject": "Con dâu Thảo đứng trên bậc thang cao, mặt trơ tráo ngắm nhẫn vàng trên tay",
      "optional_supporting_subject": "Con trai đứng bên cạnh vung tay ném tờ tiền xuống đất",
      "key_prop": "Chiếc nhẫn cưới vàng dính máu và tờ tiền bay lơ lửng",
      "setting": "Chân cầu thang biệt thự sang trọng",
      "host_emotion": "anger",
      "host_position": "left",
      "host_gaze_direction": "Nhìn sang phải với ánh mắt phẫn nộ hướng về phía hai đứa con bất hiếu",
      "text_zone": "left",
      "suggested_hook": "BẺ GÃY TAY MẸ – CƯỚP NHẪN CƯỚI",
      "attention_marker": {
        "enabled": true,
        "type": "circle",
        "target": "Chiếc nhẫn cưới trên tay con dâu"
      },
      "what_is_hidden": "Không lộ việc chiếc nhẫn có bí mật gia tài kếch xù"
    },
    {
      "concept_id": "B",
      "concept_type": "mystery",
      "concept_name": "Vật chứng bí mật – Sự thật chiếc nhẫn cưới",
      "story_moment": "Cận cảnh bàn tay con dâu run rẩy soi chiếc nhẫn dính máu dưới ánh đèn chùm",
      "visual_question": "Bí mật kinh hoàng nào ẩn giấu bên trong chiếc nhẫn cưới dính máu?",
      "main_subject": "Bàn tay con dâu cầm chiếc nhẫn cưới chạm khắc bí ẩn",
      "secondary_subject": "Gương mặt con dâu biến sắc sững sờ trong bóng tối",
      "optional_supporting_subject": null,
      "key_prop": "Chiếc nhẫn cưới vàng cổ khắc ký tự gia bảo",
      "setting": "Góc phòng khách tối với luồng sáng spotlight",
      "host_emotion": "suspicious",
      "host_position": "right",
      "host_gaze_direction": "Nhìn sang trái với ánh mắt hoài nghi, tập trung vào vật chứng",
      "text_zone": "left",
      "suggested_hook": "VỪA GIẬT ĐƯỢC NHẪN – C.HẾT LẶNG?",
      "attention_marker": {
        "enabled": true,
        "type": "arrow",
        "target": "Vết khắc trên nhẫn cưới"
      },
      "what_is_hidden": "Không lộ nội dung tờ di chúc đi kèm chiếc nhẫn"
    },
    {
      "concept_id": "C",
      "concept_type": "emotional_shock",
      "concept_name": "Nỗi đau sụp đổ – Người mẹ nghẹn ngào",
      "story_moment": "Mẹ già ôm ngực quỵ ngã trong bóng tối, nước mắt chảy dài trước sự tàn nhẫn của con",
      "visual_question": "Nỗi oan ức nào khiến người mẹ già đau đớn đến câm lặng?",
      "main_subject": "Bà mẹ già tóc bạc ướt đẫm mồ hôi và nước mắt, cơ mặt co rúm vì đau đớn",
      "secondary_subject": "Bóng lưng hai đứa con ngoảnh mặt bước lên lầu xa hoa",
      "optional_supporting_subject": null,
      "key_prop": "Tờ tiền 200 nghìn nhàu nát trên nền đất cạnh bàn tay mẹ",
      "setting": "Góc tối ẩm thấp dưới chân cầu thang hoa cương",
      "host_emotion": "grief",
      "host_position": "left",
      "host_gaze_direction": "Nhìn thẳng vào người xem với ánh mắt xót xa nghẹn ngào",
      "text_zone": "left",
      "suggested_hook": "MẸ GIÀ QUỲ LẠY – CON NÉM 200K",
      "attention_marker": {
        "enabled": false,
        "type": "none",
        "target": null
      },
      "what_is_hidden": "Không lộ cái kết bà mẹ được đền đáp"
    }
  ]
}
```
"""

THUMBNAIL_HOOKS_V1 = """Bạn là Giám đốc Sáng tạo Typography & Chuyên gia Giật Tít YouTube ("Sâm Kể Chuyện").
Nhiệm vụ: Tạo ra ÍT NHẤT 12 TEXT HOOKS TIẾNG VIỆT KÈM KẾ HOẠCH TYPOGRAPHY TOÀN DIỆN (TYPOGRAPHY PLAN).

QUY TẮC BẮT BUỘC:
1. ĐỘ DÀI TIÊU ĐỀ: 3 đến 8 từ tiếng Việt có nghĩa. Tuyệt đối không viết thành câu dài hay tóm tắt cốt truyện.
2. NGẮT DÒNG (lines): Chia tiêu đề thành 2–4 dòng ngắn gọn, chữ to, dễ đọc trên màn hình điện thoại.
3. PHÂN CẤP MÀU SẮC CHUẨN XÁC (Color Semantics):
   - white_words: Từ ngữ thông tin nền / chủ ngữ (Màu Trắng #FFFFFF).
   - yellow_words: Từ khóa hành động chính, tài sản, sự thật, con số then chốt (Màu Vàng #FFDE00).
   - red_words: Từ khóa gây sốc, tội ác, nguy hiểm, dấu hỏi cao trào (Màu Đỏ #FF3333).
   *LƯU Ý: Mỗi hook chỉ chọn tối đa 2-3 màu sắc, không tô mỗi từ một màu riêng biệt.*
4. PHÂN LOẠI DANH MỤC:
   - Ít nhất 4 Mystery Hooks
   - Ít nhất 4 Shock / Conflict Hooks
   - Ít nhất 4 Emotional Hooks
5. TYPOGRAPHY METADATA:
   - typography_style: "bold_shock" | "mystery" | "emotional"
   - text_alignment: "left" | "center" | "right"
   - preferred_text_zone: "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-center"

VÍ DỤ TIÊU ĐỀ CHUẨN:
- "ÔNG MÙ \\n THẬT SAO?" (white: ["ÔNG MÙ"], yellow: ["THẬT SAO?"])
- "ÉP BỐ \\n KÝ ĐẤT?" (white: ["ÉP BỐ"], yellow: ["KÝ ĐẤT?"])
- "TỜ GIẤY \\n 35 TỶ?" (white: ["TỜ GIẤY"], red: ["35 TỶ?"])
- "MẸ MẤT \\n 20 NGÀY..." (red: ["MẸ MẤT"], yellow: ["20 NGÀY..."])

TRẢ VỀ DUY NHẤT JSON THEO SCHEMA:
```json
{
  "hooks": [
    {
      "id": "hook_m1",
      "text": "CHIẾC NHẪN CƯỚI: BÍ MẬT 30 TỶ?",
      "category": "mystery",
      "lines": [
        "CHIẾC NHẪN CƯỚI:",
        "BÍ MẬT 30 TỶ?"
      ],
      "primary_keywords": ["BÍ MẬT 30 TỶ"],
      "yellow_words": ["BÍ MẬT 30 TỶ?"],
      "red_words": ["CHIẾC NHẪN CƯỚI:"],
      "white_words": [],
      "typography_style": "mystery",
      "text_alignment": "left",
      "preferred_text_zone": "left",
      "hidden_information": "Giá trị thật của kỷ vật gia bảo"
    },
    {
      "id": "hook_s1",
      "text": "ÉP BỐ KÝ ĐẤT?",
      "category": "shock",
      "lines": [
        "ÉP BỐ",
        "KÝ ĐẤT?"
      ],
      "primary_keywords": ["KÝ ĐẤT"],
      "yellow_words": ["KÝ ĐẤT?"],
      "red_words": [],
      "white_words": ["ÉP BỐ"],
      "typography_style": "bold_shock",
      "text_alignment": "left",
      "preferred_text_zone": "left",
      "hidden_information": "Hành vi ép buộc ký giấy chuyển nhượng tài sản"
    },
    {
      "id": "hook_e1",
      "text": "MẸ GIÀ QUỲ LẠY – CON NÉM 200K",
      "category": "emotional",
      "lines": [
        "MẸ GIÀ QUỲ LẠY",
        "CON NÉM 200K"
      ],
      "primary_keywords": ["QUỲ LẠY", "200K"],
      "yellow_words": ["CON NÉM 200K"],
      "red_words": ["MẸ GIÀ QUỲ LẠY"],
      "white_words": [],
      "typography_style": "emotional",
      "text_alignment": "left",
      "preferred_text_zone": "left",
      "hidden_information": "Sự cay đắng tột cùng của tình mẫu tử"
    }
  ]
}
```
"""

THUMBNAIL_SELECTION_V1 = """Bạn là Trưởng ban Giám sát Nghệ thuật & Đánh giá Thumbnail Fit (Thumbnail Fit Selection).
Nhiệm vụ của bạn: Đánh giá 3 Concept và 12 Hooks để chọn ra Concept và Hook tối ưu nhất cả về sức hút thị giác và khoảng trống chứa chữ (Typography integration).

TIÊU CHÍ ĐÁNH GIÁ (Thumbnail Fit & Typography Fit Criteria):
- Nhận diện tức thì (Instant clarity) < 0.5s.
- Xung đột rõ ràng, cảm xúc bùng nổ.
- Độ tò mò tâm lý (Curiosity gap) mà không bị lộ kết cục.
- Khoảng trống sạch sẽ cho Text Zone, chữ không đè lên mắt hoặc mặt nhân vật.
- Khả năng đọc trên màn hình điện thoại (Mobile readability).

MAPPING BIỂU CẢM HOST (Chỉ chọn 1 trong 6 cảm xúc):
- "shock", "grief", "anger", "disbelief", "suspicious", "serious".

TRẢ VỀ DUY NHẤT JSON THEO SCHEMA:
```json
{
  "recommended_concept_id": "A",
  "heuristic_fit_score": 95,
  "selection_rationale": "Concept A thể hiện xung đột đối đầu trực diện với độ tương phản cao, vùng text_zone bên trái đủ rộng để đặt tiêu đề cỡ lớn.",
  "host_emotion": "anger",
  "host_emotion_rationale": "Chứng kiến hành vi bất hiếu, Host mang biểu cảm phẫn nộ (anger) để tạo sự đồng cảm đạo đức.",
  "recommended_hook_id": "hook_s1",
  "recommended_title_text": "ÉP BỐ KÝ ĐẤT?",
  "recommended_badge_text": "🎙️ SÂM KỂ CHUYỆN",
  "host_position": "left",
  "text_zone": "left",
  "text_alignment": "left",
  "visual_balance_notes": "Host ở góc dưới bên trái, tiêu đề nằm ở vùng tối bên trái phía trên, nhân vật kịch tính ở bên phải."
}
```
"""

THUMBNAIL_DUAL_QC_V1 = """Bạn là Giám đốc Kiểm định Chất lượng Thị giác & Thẩm định Chữ Tiếng Việt (AI Dual Vision & Text QC Auditor).
Nhiệm vụ: Thẩm định bức ảnh Thumbnail YouTube hoàn chỉnh theo HAI CỔNG ĐÁNH GIÁ ĐỘC LẬP:

CỔNG 1: THẨM ĐỊNH THỊ GIÁC & ĐIỆN ẢNH (VISUAL QC - 20 TIÊU CHÍ):
1. story_fidelity: Bối cảnh và nhân vật drama bám sát cốt truyện.
2. correct_roles: Vai trò nhân vật (nạn nhân/kẻ gây hấn) chuẩn xác.
3. correct_key_prop: Vật chứng then chốt (nhẫn, tiền, sổ đỏ...) rõ ràng, tự nhiên.
4. host_brand_identity: Host Bác Sâm hiện diện rõ ràng, đúng mắt kính, trang phục và micro, không bị biến dạng.
5. host_placement: Vị trí Host hợp lý, tách biệt và hòa quyện với bối cảnh, không che mất nhân vật chính.
6. face_realism: Khuôn mặt nhân vật chân thực, biểu cảm sâu sắc, không mắt búp bê.
7. eyes: Ánh mắt tự nhiên, hướng nhìn chuẩn xác.
8. teeth: Răng bình thường, không dị tật.
9. hands: Bàn tay chuẩn xác, đủ 5 ngón, không dính chùm.
10. fingers: Ngón tay không bị thừa, không quái dị.
11. eyeglasses: Gọng kính chuẩn hình học.
12. body_anatomy: Tỷ lệ cơ thể chuẩn xác.
13. anti_wax_skin: Da người có lỗ chân lông, nếp nhăn, KHÔNG BỊ DA SÁP/NHỰA AI.
14. no_duplicate_faces: Không nhân bản khuôn mặt.
15. vietnamese_authenticity: Nét mặt, trang phục, bối cảnh đúng đời sống Việt Nam.
16. no_gibberish_text: Không có chữ rác hoặc ký tự AI vô nghĩa lộn xộn.
17. mystery_preservation: Không lộ kết cục/twist cuối.
18. clean_text_zone: Bố cục chữ hài hòa, không đè lên mặt người.
19. mobile_readability: Nhận diện rõ trên màn hình điện thoại nhỏ.
20. single_focal_point: Một điểm nhấn kịch tính chính, không bị phân tán.

CỔNG 2: THẨM ĐỊNH CHỮ TIẾNG VIỆT CHÍNH XÁC (EXACT TEXT QC):
- So sánh tiêu đề hiển thị trên ảnh (detected_headline) với tiêu đề kỳ vọng (expected_headline).
- YÊU CẦU CHÍNH TẢ TUYỆT ĐỐI: Dấu tiếng Việt (sắc, huyền, hỏi, ngã, nặng, đ) phải đầy đủ và chính xác 100%.
  Ví dụ: "KÝ DAT" thay vì "KÝ ĐẤT" -> text_passed = false.
  Ví dụ: "ONG MU THAT SAO" thay vì "ÔNG MÙ THẬT SAO?" -> text_passed = false.
- Kiểm tra chữ không bị đè lên mắt/mặt nhân vật (text-face collision).
- Phân loại text_match: "exact" (khớp 100%) | "minor_error" (thiếu 1 dấu nhỏ) | "major_error" (sai câu, rác chữ, mất nghĩa).

QUY TẮC ĐỀ XUẤT HÀNH ĐỘNG (recommended_action):
- visual_passed = true VÀ text_passed = true -> "accept"
- visual_passed = false -> "regenerate_scene" (sinh lại cảnh drama Stage 7A)
- visual_passed = true NHƯNG text_passed = false hoặc cần chỉnh -> "typography_repair" (chuyển sang Stage 7C/9 sửa chữ và ghép lớp lại tức thì)

TRẢ VỀ DUY NHẤT JSON THEO SCHEMA:
```json
{
  "passed": true,
  "visual_passed": true,
  "text_passed": true,
  "detected_headline": "ÉP BỐ\\nKÝ ĐẤT?",
  "expected_headline": "ÉP BỐ\\nKÝ ĐẤT?",
  "text_match": "exact",
  "issues": [
    {
      "type": "hand_anatomy",
      "severity": "low",
      "description": "Bàn tay chuẩn xác đủ 5 ngón",
      "suggested_fix": "Chấp nhận"
    }
  ],
  "recommended_action": "accept"
}
```
"""

THUMBNAIL_QC_V1 = THUMBNAIL_DUAL_QC_V1
