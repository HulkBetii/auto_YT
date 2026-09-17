# -*- coding: utf-8 -*-
"""
Story Generator Engine for Vietnamese Audio Drama (Sâm Kể Chuyện Style)
Hierarchical 3-Pass Architecture:
Pass 1: Topic & Master Blueprint (5-Act Structure)
Pass 2: 10-12 Chapter Decomposition
Pass 3: Rolling Context Chapter Expansion (~2,500 words per chapter -> 25,000-30,000 words total)
"""

import json
import random
import re
import os
import sys

ARCHETYPES = [
    {"title": "Thiếu tá Điều tra", "role": "Thiếu tá Công an / Cảnh sát điều tra tỉnh", "tone": "Bản lĩnh, trọng tình nghĩa, chính trực"},
    {"title": "Đại úy An ninh", "role": "Đại úy An ninh kinh tế", "tone": "Điềm đạm, kín tiếng, sắc sảo"},
    {"title": "Trung tá Biên phòng", "role": "Trung tá Bộ đội Biên phòng vùng biên", "tone": "Mộc mạc, giàu đức hy sinh, kiên cường"},
    {"title": "Nữ Đại úy Công an", "role": "Nữ Đại úy điều tra phá án hình sự", "tone": "Tự trọng, nhẫn nại, kiên định"},
    {"title": "Bố Lão thành / Đại tá", "role": "Đại tá quân đội đã nghỉ hưu", "tone": "Nghiêm nghị, yêu thương gia đình, quyết đoán"}
]

SACRIFICES = [
    "Bán toàn bộ của hồi môn và vàng cưới của mẹ đẻ để lo vốn cho chồng lập nghiệp",
    "Một mình tần tảo chăm sóc mẹ chồng bị tai biến liệt giường suốt 6 năm không một lời than vãn",
    "Gửi toàn bộ lương thưởng và tiền bán đất dưỡng già của mẹ nghèo ở quê cho vợ tay hòm chìa khóa",
    "Từ chối cơ hội chuyển công tác lên cấp tỉnh để ở lại quê nhà chăm sóc bố mẹ chồng",
    "Nuôi nấng con riêng của chồng và cưu mang em chồng học đại học thành đạt"
]

OPPRESSIONS = [
    "Chồng rước Tiểu tam có bầu về nhà, mẹ chồng ép con dâu ra đi tay trắng trong đêm mưa",
    "Bị vu oan làm thâm hụt tiền công ty, mẹ chồng bắt quỳ lạy xin lỗi và ép ký giấy từ bỏ quyền nuôi con",
    "Chồng và Tiểu tam cấu kết làm giả chữ ký để bán căn biệt thự 12 tỷ vốn là tài sản riêng của vợ",
    "Con dâu cậy giàu có ngược đãi bố chồng thương binh cụt tay, bắt ăn cơm thừa dưới bếp",
    "Bị đầu độc ngầm / hãm hại tai nạn khiến mù mắt tạm thời, nhân tình lập tức kéo vali đến chiếm nhà"
]

PLOT_SECRETS = [
    "Căn nhà 12 tỷ thực chất đứng tên riêng do bố mẹ đẻ mua từ trước ngày cưới",
    "Nhân vật chính giả vờ mù / giả vờ bệnh nặng để ghi âm toàn bộ bằng chứng tống tiền và phản bội",
    "Vợ cũ thực chất là Tổ trưởng chuyên án đang bí mật điều tra đường dây lừa đảo của gã nhân tình",
    "Người ăn xin bị hắt hủi thực chất là ân nhân từng cứu mạng cha của người chồng 20 năm trước",
    "Chiếc điện thoại bị ném xuống sông được thợ lặn trục vớt, khôi phục toàn bộ tin nhắn trước khi bị hại"
]

RETRIBUTIONS = [
    "Cảnh sát kinh tế ập vào phòng công chứng bắt giữ Tiểu tam và Chồng vì tội lừa đảo 15 tỷ",
    "Mẹ chồng chết lặng khi thấy toàn bộ công an tỉnh cúi đầu chào con dâu là Sếp chỉ huy",
    "Gã nhân tình ôm tiền bỏ trốn để lại món nợ 8 tỷ cho người vợ bội bạc gánh chịu",
    "Công ty phá sản, đối tác rút vốn đồng loạt vì phát hiện đạo đức giả tạo của kẻ vong ân",
    "Kẻ thủ ác phải tra tay vào còng số 8 ngay trước ngày tổ chức đám cưới xa hoa"
]

MORALS = [
    "Giá trị của người phụ nữ không nằm ở sự cam chịu, mà là dũng cảm sống vì sự thật và phẩm giá",
    "Đời người dài lắm, đừng bao giờ lấy lòng tốt của người khác để làm bàn đạp cho sự tham lam",
    "Nhân quả có thể đến muộn nhưng không bao giờ bỏ sót, sống bất nghĩa ắt có ngày trắng tay",
    "Trở về bình yên không phải là quay lại nơi cũ, mà là tìm lại được chính mình sau bao năm vì người khác"
]

def generate_topic_seed():
    arch = random.choice(ARCHETYPES)
    sac = random.choice(SACRIFICES)
    opp = random.choice(OPPRESSIONS)
    sec = random.choice(PLOT_SECRETS)
    ret = random.choice(RETRIBUTIONS)
    mor = random.choice(MORALS)
    
    title = f"{arch['title']} Giả Mù Sau Tai Nạn – Chồng và Tiểu Tam Chết Lặng Khi Thấy 20 Cảnh Sát Gọi Vợ Là Sếp | Sâm Kể Chuyện"
    
    return {
        "title": title,
        "archetype": arch,
        "sacrifice": sac,
        "oppression": opp,
        "plot_secret": sec,
        "retribution": ret,
        "moral": mor
    }

def generate_master_blueprint(topic_seed):
    """Creates 5-Act narrative framework"""
    return {
        "title": topic_seed["title"],
        "hook": f"(00:01) [SPEAKER:bac_sam] Đêm nay bác Sâm xin mời quý vị ngồi lại thật chậm để nghe câu chuyện của cháu {topic_seed['archetype']['title']}. Một người lính quen hiểm nguy ngoài sa trường, lại không ngờ nhát dao đau đớn nhất lại đến từ chính mái ấm của mình...",
        "act1": f"Hồi 1 - Những năm tháng nghèo khó và sự hy sinh thầm lặng: {topic_seed['sacrifice']}. Cuộc sống êm ấm ban đầu và niềm tin tuyệt đối.",
        "act2": f"Hồi 2 - Vết nứt âm thầm và lòng dạ đổi thay: Dấu hiệu ngoại tình, mẹ chồng cay nghiệt, sự xuất hiện của kẻ thứ ba. {topic_seed['oppression']}.",
        "act3": f"Hồi 3 - Giọt nước tràn ly và cuộc điều tra ngầm: Phát hiện âm mưu tẩu tán tài sản. {topic_seed['plot_secret']}. Nhân vật quyết định không nhẫn nhịn.",
        "act4": f"Hồi 4 - Cao trào đối đầu và Cán cân công lý: {topic_seed['retribution']}. Khoảnh khắc lật kèo phơi bày sự thật khiến kẻ ác chết lặng.",
        "act5": f"Hồi 5 - Hậu vận, Bình yên và Bài học nhân sinh: {topic_seed['moral']}. Nhân vật tìm lại sự an yên bên người thân yêu.",
        "moral_summary": topic_seed["moral"]
    }

def generate_chapters_outline(blueprint):
    """Breaks into 10 detailed chapters (~2,500 words each)"""
    chapters = [
        {"number": 1, "act": "Hồi 1", "title": "Bát cơm nguội và lời thề ngày nghèo khó", "goal": "Khắc họa tuổi thơ khó khăn, xuất thân người lính, cưới nhau bằng tình nghĩa mộc mạc."},
        {"number": 2, "act": "Hồi 1", "title": "Mái nhà xây bằng những nhọc nhằn", "goal": "Sự hy sinh của nhân vật chính, giao tiền bạc cho đối phương quản lý, niềm tin trọn vẹn."},
        {"number": 3, "act": "Hồi 2", "title": "Những cuộc gọi đêm và mật khẩu đổi thay", "goal": "Dấu hiệu lạnh nhạt đầu tiên, đối phương bắt đầu chê bai nhân vật quê mùa, không biết kiếm tiền."},
        {"number": 4, "act": "Hồi 2", "title": "Khi người thứ ba bước qua ngưỡng cửa", "goal": "Tiểu tam xuất hiện công khai, mẹ chồng hùa theo ép uổng, đẩy mâu thuẫn gia đình lên cao."},
        {"number": 5, "act": "Hồi 3", "title": "Biến cố bất ngờ và lòng người lộ diện", "goal": "Nhân vật gặp tai nạn hoặc giả mù/bệnh, nghe lén âm mưu sang tên tài sản trong đêm."},
        {"number": 6, "act": "Hồi 3", "title": "Thu thập từng mảnh chứng cứ trong bóng tối", "goal": "Nhân vật chính âm thầm phối hợp đồng đội/luật sư, khôi phục giấy tờ và sao kê ngân hàng."},
        {"number": 7, "act": "Hồi 4", "title": "Bản hợp đồng chuyển nhượng 12 tỷ", "goal": "Cảnh mẹ chồng và tiểu tam ép ký giấy, nhân vật chính dứt khoát đứng dậy đối chất."},
        {"number": 8, "act": "Hồi 4", "title": "Cầu vai sắc phục và sự chết lặng", "goal": "Thân phận Sĩ quan / Chủ nhân thực sự lộ diện, lực lượng chức năng ập vào bắt quả tang."},
        {"number": 9, "act": "Hồi 5", "title": "Cái giá đắt của sự vong ân", "goal": "Gia đình chồng tan tác, tiểu tam và chồng nhận án phạt pháp luật, hối hận muộn màng."},
        {"number": 10, "act": "Hồi 5", "title": "Bát phở ấm bên đường và ngày trở về", "goal": "Nhân vật chính thanh thản dẫn con đi ăn, đúc kết bài học đạo lý cuộc đời cùng Bác Sâm."}
    ]
    return chapters

if __name__ == '__main__':
    seed = generate_topic_seed()
    bp = generate_master_blueprint(seed)
    chaps = generate_chapters_outline(bp)
    print("=== TOPIC GENERATED ===")
    print("Title:", seed["title"])
    print("Total chapters:", len(chaps))
