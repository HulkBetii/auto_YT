/**
 * 5-Turn Prompt Templates for Vietnamese Long-Form Audio Drama (Sâm Kể Chuyện Style)
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
  }) => `Bạn là chuyên gia biên kịch hàng đầu cho các chương trình truyện audio tâm sự, drama gia đình dài 2.5 giờ trên YouTube (phong cách kênh "Sâm Kể Chuyện"). 

Dựa trên hạt mầm đề tài sau:
- Thân phận nhân vật chính: ${topicSeed.archetype}
- Sự hy sinh ban đầu: ${topicSeed.sacrifice}
- Hành vi áp bức / Bạc bẽo: ${topicSeed.oppression}
- Bí mật lật kèo: ${topicSeed.plotSecret}
- Cán cân công lý / Trả giá: ${topicSeed.retribution}
- Bài học đạo lý: ${topicSeed.moral}

HÃY LẬP BẢN MASTER BLUEPRINT VÀ DÀN Ý 10 CHƯƠNG CHI TIẾT (CHUẨN BỊ CHO BỘ TRUYỆN DÀI 30.000 TỪ):

Yêu cầu xuất ra cấu trúc:
1. TIÊU ĐỀ CHÍNH (Giật gân, đánh vào lòng trắc ẩn và công lý, có dấu chấm lách kiểm duyệt từ khóa nhạy cảm).
2. HỒ SƠ NHÂN VẬT (Tên tuổi, nghề nghiệp, tính cách của: Nhân vật chính, Người bạn đời phản bội, Tiểu tam, Mẹ chồng/Mẹ đẻ, Đồng đội hỗ trợ).
3. KHUNG 5 HỒI KỊCH BẢN (Tóm tắt cốt lõi từng hồi từ Hồi 1 đến Hồi 5).
4. DÀN Ý 10 CHƯƠNG CHI TIẾT:
   - Mỗi chương ghi rõ: Tên chương, Hồi thuộc về, Mục tiêu kịch tính, Sự kiện chính xảy ra, Dự kiến dung lượng (~2.500 - 3.000 từ).

LƯU Ý QUAN TRỌNG:
- Văn phong tự sự ngôi thứ nhất, bối cảnh gia đình Việt Nam miền Bắc/Bắc Trung Bộ.
- Giữ vững mạch truyện sâu sắc, nghẹn ngào nhưng kiên cường.
- Không tóm tắt qua loa. Chỉ xuất nội dung Blueprint sạch sẽ.`,

  TURN_2_CHAPTERS_1_TO_4: `Tuyệt vời! Bây giờ dựa trên Master Blueprint đã duyệt ở trên, bạn hãy viết TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 4 CHƯƠNG ĐẦU TIÊN (Chương 1, Chương 2, Chương 3, Chương 4) với tổng dung lượng khoảng 8.000 - 10.000 từ.

QUY TẮC BẮT BUỘC KHI VIẾT:
1. ĐOẠN MỞ ĐẦU (00:01):
   - Mở đầu bằng lời dẫn chiêm nghiệm sâu sắc của Bác Sâm: Gắn tag [SPEAKER:bac_sam] "Kính chào quý vị và các bạn đang lắng nghe Sâm kể chuyện. Đêm nay bác Sâm xin mời quý vị ngồi lại thật chậm để nghe một câu chuyện...".
   - Sau đó chuyển giao sang nhân vật chính: ">> [SPEAKER:nhan_vat_chinh] Cháu chào bác Sâm, cháu chào tất cả cô chú, anh chị đang nghe chương trình...".
2. VĂN PHONG TỰ SỰ SÂU SẮC (SÂM KỂ CHUYỆN STYLE):
   - Xưng hô "Cháu" xuyên suốt câu chuyện.
   - Bơm dày đặc các chi tiết giác quan đời thường: Mâm cơm có đĩa rau muống luộc chấm tương, đôi dép rách buộc dây thép, mùi mồ hôi sau ca trực, tiếng thìa va vào bát sứ, tiếng cười vọng qua cầu thang...
   - Miêu tả sâu độc thoại nội tâm: Sự dằn vặt, niềm tin ngây thơ ban đầu, cảm giác lạnh sống lưng khi phát hiện sự bất thường đầu tiên.
3. GÁN NHÃN GIỌNG ĐỌC (SPEAKER TAGS):
   - Khi có lời đối thoại trực tiếp trong ngoặc kép của nhân vật khác, hãy gán nhãn rõ ràng: [SPEAKER:me_chong], [SPEAKER:tieu_tam], [SPEAKER:nhan_vat_chinh].
4. DUNG LƯỢNG: Viết cực kỳ chi tiết, chậm rãi, đầy đặn từng phân cảnh, không được tóm tắt lướt qua. Hãy viết đầy đủ từng chương từ Chương 1 đến hết Chương 4.`,

  TURN_3_CHAPTERS_5_TO_7: `Rất xuất sắc! Mạch truyện đang rất cuốn hút và giàu cảm xúc. Bây giờ hãy viết tiếp TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 3 CHƯƠNG TIẾP THEO (Chương 5, Chương 6, Chương 7) với tổng dung lượng khoảng 8.000 - 10.000 từ.

TRỌNG TÂM CỦA GIAI ĐOẠN NÀY (HỒI 3 - BIẾN CỐ & ĐIỀU TRA TRONG BÓNG TỐI):
- Chương 5: Biến cố tai nạn xảy ra / Nhân vật chính giả mù (hoặc giả bệnh). Đêm đầu tiên về nhà, nghe lén toàn bộ cuộc trò chuyện trơ trẽn giữa chồng/vợ và nhân tình ngoài ban công về kế hoạch tẩu tán tài sản tiền tỷ.
- Chương 6: Thu thập chứng cứ trong bóng tối. Sự phối hợp bí mật với đồng đội, luật sư, trích xuất camera, sao kê ngân hàng, khôi phục dữ liệu tin nhắn bị xóa.
- Chương 7: Giọt nước tràn ly. Cảnh kẻ phản bội và mẹ chồng lộ rõ bộ mặt tàn nhẫn, ép ký giấy tờ sang nhượng tài sản ngay trước mặt nhân tình. Sự kìm nén đỉnh điểm của nhân vật chính.

QUY TẮC:
- Tiếp tục duy trì ngôi kể "Cháu" [SPEAKER:nhan_vat_chinh] và các thẻ [SPEAKER:me_chong], [SPEAKER:tieu_tam] khi có đối thoại.
- Khắc họa chân thực sự đau đớn đến tột cùng chuyển hóa thành sự bình tĩnh, quyết đoán.
- Viết chi tiết, dài và đầy đặn, không tóm tắt.`,

  TURN_4_CHAPTERS_8_TO_10: `Rất tuyệt vời! Bây giờ là phần quan trọng nhất: Hãy viết TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 3 CHƯƠNG CUỐI CÙNG (Chương 8, Chương 9, Chương 10) với tổng dung lượng khoảng 8.000 - 10.000 từ để hoàn tất toàn bộ câu chuyện 30.000 từ.

TRỌNG TÂM CỦA GIAI ĐOẠN NÀY (HỒI 4 & HỒI 5 - LẬT KÈO, CÔNG LÝ & HẬU VẬN):
- Chương 8: Khoảnh khắc lật kèo kinh điển. Nhân vật chính dứt khoát bước ra trong bộ sắc phục Sĩ quan Công an/Quân đội hoặc mang hồ sơ pháp lý khẳng định quyền sở hữu. Lực lượng chức năng ập vào bắt quả tang hành vi lừa đảo/làm giả giấy tờ. Sự sụp đổ và "chết lặng" hoàn toàn của kẻ ác.
- Chương 9: Cái giá phải trả của sự bất nghĩa. Kẻ vong ân nhận bản án nghiêm minh của pháp luật, gia đình chồng tan nát, sự hối hận muộn màng trong trại giam.
- Chương 10: Bình yên trở về và Bài học nhân sinh:
  * Nhân vật chính dẫn con nhỏ / cha mẹ già đi ăn bát phở nóng bên đường, tìm lại sự thanh thản trong tâm hồn.
  * Nhân vật đúc kết đạo lý cuộc đời: "Giá trị của một con người không nằm ở sự cam chịu, mà là dám đứng lên vì danh dự và sự thật...".
  * [SPEAKER:bac_sam] Bác Sâm quay lại với lời chào kết ấm áp, đúc kết bài học nhân quả cho người nghe, kêu gọi like, chia sẻ và đăng ký kênh Sâm Kể Chuyện.

QUY TẮC:
- Viết trọn vẹn, xúc động, giàu tính nhân văn và công lý. Đảm bảo dung lượng đầy đặn không rút gọn.`,

  TURN_5_METADATA_SEO: `Hãy tổng hợp và tạo TRỌN BỘ METADATA SEO YOUTUBE HOÀN CHỈNH cho video kịch bản trên:

CẤU TRÚC BẮT BUỘC:
1. TIÊU ĐỀ CHÍNH & 5 TIÊU ĐỀ BIẾN THỂ A/B TEST (Chuẩn giật gân, đánh trúng tâm lý, có chấm lách kiểm duyệt từ khóa như: B.ắt, T.ội Á.c, C.hết L.ặng, N.hân T.ình...).
2. MÔ TẢ VIDEO YOUTUBE (Description 6 phần chuẩn SEO):
   - Phần 1: Hook mở đầu 3 dòng tóm tắt kịch tính khơi gợi tò mò.
   - Phần 2: Giới thiệu câu chuyện sâu sắc.
   - Phần 3: Mục lục Chapters đầy đủ 10 chương kèm mốc thời gian.
   - Phần 4: Kêu gọi hành động (CTA: Like, Share, Đăng ký kênh).
   - Phần 5: Đoạn MIỄN TRỪ TRÁCH NHIỆM (Khẳng định truyện hư cấu, nhân vật tưởng tượng, giọng đọc AI để tuân thủ 100% chính sách YouTube).
   - Phần 6: 10 Hashtags chuẩn (#samkechuyen #tamsucungvansam #truyenaudio...).
3. DANH SÁCH 20 TAGS SEO YOUTUBE (Dạng danh sách phân cách dấu phẩy để copy dán vào ô Tags).
4. PROMPT TẠO ẢNH THUMBNAIL (Bằng tiếng Anh cho Midjourney/Flux mô tả chi tiết nhân vật chính mặc sắc phục hoặc gương mặt phụ nữ khắc khổ giàu cảm xúc, nền tương phản cao).`
};
