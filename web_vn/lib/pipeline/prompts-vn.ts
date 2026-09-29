/**
 * 6-Turn Prompt Templates for Vietnamese Long-Form Audio Drama (Sâm Kể Chuyện Style)
 * Length: 1h00 – 1h30 (11,000 – 12,500 words, 10 chapters)
 * Designed for Playwright ChatGPT Session with full context preservation.
 */

export const PROMPTS_VN = {
  TURN_1_BLUEPRINT: (topicSeed: {
    title: string;
    archetype: string;
    sacrifice: string;
    oppression: string;
    plotSecret: string;
    retribution: string;
    moral: string;
    defaultPronoun?: string;
    victimRole?: string;
    victimRoleName?: string;
    antagonist1Role?: string;
    antagonist1Name?: string;
    antagonist2Role?: string;
    antagonist2Name?: string;
    justiceRole?: string;
    justiceName?: string;
  }) => `Bạn là chuyên gia biên kịch hàng đầu cho các chương trình truyện audio tâm sự, drama gia đình dài 1h00 đến 1h30 (60 – 90 phút, chuẩn 11.000 – 12.500 từ) trên YouTube (phong cách kênh "Sâm Kể Chuyện"). 

Dựa trên hạt mầm đề tài mang tính Viral Outlier cao sau:
- Thân phận nhân vật chính (Nạn nhân): ${topicSeed.archetype} (Đại từ xưng hô tự sự: "${topicSeed.defaultPronoun || 'Cháu'}")
- Sự hy sinh ban đầu: ${topicSeed.sacrifice}
- Hành vi áp bức / Bạc bẽo: ${topicSeed.oppression}
- Bí mật lật kèo: ${topicSeed.plotSecret}
- Cán cân công lý / Trả giá: ${topicSeed.retribution}
- Bài học đạo lý: ${topicSeed.moral}

HÃY LẬP BẢN MASTER BLUEPRINT VÀ DÀN Ý 10 CHƯƠNG CHI TIẾT (CHUẨN BỊ CHO BỘ TRUYỆN DÀI 11.000 – 12.500 TỪ):

Yêu cầu xuất ra cấu trúc:
1. TIÊU ĐỀ CHÍNH & 3 TIÊU ĐỀ BIẾN THỂ (Giật gân, có chấm lách kiểm duyệt từ khóa nhạy cảm).
2. HỒ SƠ 5 NHÂN VẬT CHÍNH (Gán mã giọng đọc chuẩn):
   - [SPEAKER:bac_sam] Bác Sâm - Người dẫn chuyện chiêm nghiệm, trầm ấm.
   - [SPEAKER:${topicSeed.victimRole || 'nhan_vat_chinh'}] ${topicSeed.victimRoleName || 'Nhân vật chính'} - Tự sự ngôi thứ nhất "${topicSeed.defaultPronoun || 'Cháu'}", tự trọng, kiên cường, giàu đức hy sinh.
   - [SPEAKER:${topicSeed.antagonist1Role || 'me_chong'}] ${topicSeed.antagonist1Name || 'Kẻ đối kháng 1'} - Tham lam, cay nghiệt hoặc hỗn xược.
   - [SPEAKER:${topicSeed.antagonist2Role || 'tieu_tam'}] ${topicSeed.antagonist2Name || 'Kẻ đối kháng 2'} - Vô ơn, trơ trẽn hoặc nhu nhược.
   - [SPEAKER:${topicSeed.justiceRole || 'can_bo'}] ${topicSeed.justiceName || 'Đại diện công lý'} - Công lý phân minh, nghiêm minh.
3. KHUNG 5 HỒI KỊCH BẢN (Tóm tắt cốt lõi từng hồi: Khởi đầu & Hy sinh -> Áp bức & Bạc bẽo -> Biến cố & Âm thầm điều tra -> Cao trào lật kèo & Công lý -> Nhân quả & Bình yên).
4. DÀN Ý 10 CHƯƠNG CHI TIẾT (Mỗi chương khoảng 1.100 - 1.300 từ): Tên chương, Mục tiêu kịch tính, Sự kiện chính xảy ra, Cao trào kết chương.

OUTPUT: Xuất nội dung Blueprint sạch sẽ, chuyên nghiệp.`,

  TURN_2_CHAPTERS_1_TO_3: `Dựa trên Master Blueprint đã duyệt, bạn hãy viết TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 3 CHƯƠNG ĐẦU TIÊN (Chương 1, Chương 2, Chương 3) với tổng dung lượng khoảng 3.300 - 3.800 từ (~1.100 - 1.300 từ/chương).

QUY TẮC BẮT BUỘC VỀ ĐỊNH DẠNG & PHÂN VAI (BẮT BUỘC TUÂN THỦ 100%):
1. QUY CHUẨN XUỐNG DÒNG & TAG NHÂN VẬT:
   - MỖI ĐOẠN VĂN HOẶC CÂU THOẠI PHẢI BẮT ĐẦU TRÊN MỘT DÒNG RIÊNG VỚI ĐÚNG TAG CỤ THỂ [SPEAKER:role_id].
   - TUYỆT ĐỐI KHÔNG xuất thẻ [SPEAKER] trơ trọi không có tên vai! Mọi tag BẮT BUỘC phải có hậu tố role_id (ví dụ: [SPEAKER:nhan_vat_chinh], [SPEAKER:me_chong], [SPEAKER:tieu_tam]...).
2. MẪU ĐỊNH DẠNG BẮT BUỘC (FEW-SHOT):
   [SPEAKER:bac_sam] Kính chào quý vị và các bạn đang lắng nghe Sâm Kể Chuyện...
   [SPEAKER:nhan_vat_chinh] Bước vào phòng khách, tôi sững người khi thấy người phụ nữ lạ mặt đang ngồi gọt táo.
   [SPEAKER:me_chong] "Con ăn thêm miếng táo đi, đang có bầu thì phải chịu khó bồi dưỡng."
   [SPEAKER:tieu_tam] "Chị về rồi đấy à? Em xin lỗi vì đã đường đột đến đây."
   [SPEAKER:nhan_vat_chinh] Tôi siết chặt bàn tay: "Cô đến đây làm gì?"
3. TUYỆT ĐỐI KHÔNG DÙNG THẺ CẢM XÚC NHÂN TẠO như [thở dài], [cười], [khóc]... Chỉ dùng dấu câu tự nhiên (., ! ? …).
4. TIÊU ĐỀ CHƯƠNG & NỘI DUNG: Ghi rõ tiêu đề theo Blueprint (CHƯƠNG 1: ..., CHƯƠNG 2: ..., CHƯƠNG 3: ...). Viết chi tiết, giàu hình ảnh đời thực.`,

  TURN_3_CHAPTERS_4_TO_6: `Mạch truyện rất cuốn hút và cảm xúc! Bây giờ hãy viết tiếp TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 3 CHƯƠNG TIẾP THEO (Chương 4, Chương 5, Chương 6) bám sát Dàn ý Blueprint đã duyệt (HỒI 2 & HỒI 3 - ĐỈNH ĐIỂM ÁP BỨC, BI KỊCH & ÂM THẦM THU THẬP CHỨNG CỨ) với tổng dung lượng khoảng 3.500 - 4.000 từ (~1.200 - 1.350 từ/chương).

QUY TẮC BẮT BUỘC:
- MỖI ĐOẠN VĂN HOẶC CÂU THOẠI BẮT BUỘC BẮT ĐẦU TRÊN MỘT DÒNG MỚI VỚI ĐÚNG TAG [SPEAKER:role_id].
- TUYỆT ĐỐI KHÔNG xuất [SPEAKER] trơ trọi.
- TUYỆT ĐỐI KHÔNG DÙNG THẺ CẢM XÚC NHÂN TẠO.
- Viết chi tiết, sâu sắc, đẩy mâu thuẫn lên cao trào kịch tính.`,

  TURN_4_CHAPTERS_7_TO_9: `Rất tuyệt vời! Bây giờ hãy viết TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 3 CHƯƠNG CAO TRÀO (Chương 7, Chương 8, Chương 9) bám sát Dàn ý Blueprint (HỒI 4 - BẮT QUẢ TANG, LẬT KÈO KINH ĐIỂN & PHÁP LUẬT / CÔNG LÝ THỰC THI) với tổng dung lượng khoảng 3.500 - 4.000 từ (~1.200 - 1.350 từ/chương).

QUY TẮC BẮT BUỘC:
- MỖI ĐOẠN VĂN HOẶC CÂU THOẠI BẮT BUỘC BẮT ĐẦU TRÊN MỘT DÒNG MỚI VỚI ĐÚNG TAG [SPEAKER:role_id].
- TUYỆT ĐỐI KHÔNG xuất [SPEAKER] trơ trọi.
- TUYỆT ĐỐI KHÔNG DÙNG THẺ CẢM XÚC NHÂN TẠO.
- Khắc họa cảm xúc đối lập cực mạnh: Từ hả hê trơ trẽn sang bàng hoàng sụp đổ khi công lý được thực thi.`,

  TURN_5_CHAPTER_10_OUTRO: `Rất xuất sắc! Bây giờ hãy viết CHƯƠNG 10 VÀ LỜI KẾT BÁC SÂM (HỒI 5 - NHÂN QUẢ PHÂN MINH, BÌNH YÊN & BÀI HỌC CUỘC ĐỜI) với dung lượng khoảng 1.300 - 1.600 từ:

CẤU TRÚC:
1. CHƯƠNG 10: Theo dàn ý Blueprint (Bản án nghiêm minh cho kẻ ác, nhân vật chính tìm lại sự thanh thản, tự do và phẩm giá).
2. LỜI CHÀO KẾT CỦA BÁC SÂM: [SPEAKER:bac_sam] Phân tích đạo lý nhân quả, chúc quý khán thính giả an lành, kêu gọi bấm Đăng ký kênh Sâm Kể Chuyện.

QUY TẮC BẮT BUỘC:
- MỖI ĐOẠN VĂN BẮT ĐẦU TRÊN MỘT DÒNG MỚI VỚI ĐÚNG TAG [SPEAKER:nhan_vat_chinh] HOẶC [SPEAKER:bac_sam].
- TUYỆT ĐỐI KHÔNG xuất [SPEAKER] trơ trọi.
- TUYỆT ĐỐI KHÔNG DÙNG THẺ CẢM XÚC NHÂN TẠO.`,

  TURN_6_METADATA_SEO: `Hãy tổng hợp và tạo TRỌN BỘ METADATA SEO YOUTUBE HOÀN CHỈNH cho video kịch bản trên:

CẤU TRÚC BẮT BUỘC:
1. TIÊU ĐỀ CHÍNH & 5 TIÊU ĐỀ BIẾN THỂ A/B TEST (Chuẩn giật gân, đánh trúng tâm lý, có chấm lách kiểm duyệt từ khóa).
2. MÔ TẢ VIDEO YOUTUBE (Description 6 phần chuẩn SEO):
   - Phần 1: Hook mở đầu 3 dòng tóm tắt kịch tính khơi gợi tò mò.
   - Phần 2: Giới thiệu câu chuyện sâu sắc.
   - Phần 3: Mục lục Chapters đầy đủ 10 chương kèm mốc thời gian.
   - Phần 4: Kêu gọi hành động (CTA: Like, Share, Đăng ký kênh).
   - Phần 5: Đoạn MIỄN TRỪ TRÁCH NHIỆM (Khẳng định truyện hư cấu, nhân vật tưởng tượng, giọng đọc AI để tuân thủ 100% chính sách YouTube).
   - Phần 6: 10 Hashtags chuẩn (#samkechuyen #tamsucungvansam #truyenaudio...).
3. DANH SÁCH 20 TAGS SEO YOUTUBE (Dạng danh sách phân cách dấu phẩy để copy dán vào ô Tags).
4. PROMPT TẠO ẢNH THUMBNAIL (Bằng tiếng Anh cho Midjourney/Flux mô tả chi tiết nhân vật chính mặc trang phục uy nghiêm hoặc gương mặt phụ nữ/người già khắc khổ giàu cảm xúc, nền tương phản cao).`
};
