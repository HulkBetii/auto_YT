"""
Playwright ChatGPT automation for full 5-turn Japanese Drama Video workflow:
Turn 1: Japanese drama narration script
Turn 2: High CTR Japanese title starting with 【99％が知らない】
Turn 3: SEO video description with 3 #hashtags
Turn 4: 3-line dramatic thumbnail text
Turn 5: Generate complete 16:9 Thumbnail Image with @Create image using character base "phoi-ko-jp.png"
All 5 turns execute sequentially in the SAME CHAT SESSION for context preservation.
"""
import sys
import os
import re
import json
import asyncio
import logging
import base64
import urllib.request
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

sys.stdout.reconfigure(encoding="utf-8")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("chatgpt_drama")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
SRC_DIR = REPO_ROOT / "src"
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from auto_yt.paths import gpt_profile_dir
from playwright.async_api import async_playwright, Page, BrowserContext

CHATGPT_URL = "https://chatgpt.com/"
PROMPT_INPUT_SELECTOR = 'div[contenteditable="true"][role="textbox"], #prompt-textarea, [data-composer-markdown], div.ProseMirror'
ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]'
STOP_SELECTOR = 'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label*="Stop"]'
SEND_SELECTORS = (
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[aria-label*="Send"]',
)
NEW_CHAT_SELECTOR = '[data-testid="create-new-chat-button"], a[href="/"]'
FILE_INPUT_SELECTOR = 'input[type="file"]'

RENDERED_MESSAGE_TEXT_SCRIPT = """
(node) => {
  const clone = node.cloneNode(true);
  for (const list of clone.querySelectorAll("ol, ul")) {
    const ordered = list.tagName === "OL";
    const start = ordered ? Number(list.getAttribute("start") || "1") : 1;
    const items = Array.from(list.children).filter((child) => child.tagName === "LI");
    items.forEach((item, index) => {
      const marker = ordered ? `${start + index}. ` : "- ";
      const firstParagraph = Array.from(item.children).find((child) => child.tagName === "P");
      const target = firstParagraph || item;
      target.insertBefore(document.createTextNode(marker), target.firstChild);
    });
  }
  return clone.innerText || clone.textContent || "";
}
"""

PROMPT_TURN1_TEMPLATE = """Viết lại nội dung đính kèm thành nội dung kịch bản tiếng Nhật theo văn nói (với hook gây sốc để giữ chân người xem), giọng NGƯỜI GIÀ NHẬT BẢN, ngôi thứ nhất (giới tính là Nam) (người trong chuyện tự kể, XƯNG HÔ nhất quán toàn bài), GAY GẮT, KHẲNG ĐỊNH, THÔ RÁP, DRAMA. Không nêu tuổi cụ thể, bối cảnh trong nước Nhật, KHÔNG dùng 日本人の私たち／我々日本人 hay bất kỳ cách nói đứng ngoài nhìn vào. Được phóng đại, mệnh lệnh ném thẳng, phán dứt khoát, không hedging. Câu ngắn dồn dập xen câu dài. Không đều nhịp. Không viết như bài giảng. Đặc biệt phải phù hợp với văn hóa và con người nước Nhật Bản. OUTPUT: chỉ text tiếng Nhật sạch, không tiêu đề, không giải thích, không markdown. Viết kanji + kana bình thường như văn bản Nhật tự nhiên, chỉ ép sang kana riêng những từ bị đọc sai (số, lượng từ, tên riêng, chuỗi thuần kanji) (không nhắc đến tên kênh).

{title} - YouTube
{url}

Transcript:
{transcript}"""

PROMPT_TURN2_TEMPLATE = """Dựa trên kịch bản vừa viết, hãy tạo TIÊU ĐỀ YOUTUBE tiếng Nhật đạt CTR cao nhất cho ngách 処世訓・人生哲学ドラマ (khán giả 50-75 tuổi Nhật Bản).

QUY TẮC BẮT BUỘC:
- Tổng độ dài: 32-55 ký tự (không kể khoảng trắng kép).
- 20-28 ký tự ĐẦU TIÊN phải hoàn chỉnh mệnh đề cảnh báo/tổn thất cốt lõi.
- PHẢI chứa con số cụ thể (số lượng đặc điểm, tuổi, %) HOẶC động từ mệnh lệnh mạnh.
- Sau dấu ｜ là bối cảnh triết lý hoặc hậu quả cụ thể.
- TUYỆT ĐỐI KHÔNG dùng 【99%が知らない】 (cụm này quá cũ, mất uy tín).
- Thay thế bằng: 「多くの人が見落とす」「意外と知られていない」「気づかない人が多い」「最後まで気づきにくい」hoặc dạng không prefix.

5 FORMULA CHO PHÉP (chọn formula PHÙ HỢP NHẤT với nội dung kịch bản):
1. 【Yếu tố hiếm/sốc】[Đối tượng]の[Đặc điểm]〇選｜[Hành động mệnh lệnh]と[Hậu quả cụ thể]
2. [Người làm X]の人は注意｜今すぐ[Hành động phòng thủ]すべき理由
3. [Tuổi cụ thể]で絶対に[Hành động]べきこと〇つ｜死ぬ前に激しく後悔する
4. わしは長く生きてきた。[Đối tượng cụ thể]だけは絶対に[Mệnh lệnh tiêu cực]
5. この〇つを[Hành động]すれば、[Vấn đề lớn]の〇割は消える

OUTPUT FORMAT BẮT BUỘC (3 dòng, không giải thích, không thêm gì khác):
A: [Tiêu đề mạnh nhất — Warning/Conflict hook — dùng formula phù hợp nhất]
B: [Tiêu đề thứ hai — Paradox/Đảo ngược kỳ vọng — cùng chủ đề nhưng góc khác]
C: [Tiêu đề thứ ba — Age-specific/Life-stage — nhắm thẳng tuổi 60-70]"""

PROMPT_TURN3_TEMPLATE = """Dựa trên kịch bản vừa viết, tạo MÔ TẢ VIDEO YouTube + TAGS + PINNED COMMENT chuẩn SEO thị trường Nhật Bản (ngách 処世訓・人生哲学ドラマ, khán giả 50-75 tuổi).

━━━ PHẦN 1: MÔ TẢ VIDEO (Description) ━━━

【BLOCK 1 — HOOK (80 ký tự đầu trước nút もっと見る)】
3 dòng mở đầu nói thẳng vào nỗi đau của người 50-70 tuổi. Phải gây khó chịu, bứt rứt, không thể bỏ qua.
Format:
「[Tình huống quen thuộc/Sự thật cay đắng mà khán giả đang sống]。」
今回は、[Nội dung cốt lõi cụ thể của video này]についてお話しします。
[Lý do khẩn cấp — tại sao phải nghe ngay bây giờ, không phải sau]。

【BLOCK 2 — KÊNH NÀY DÀNH CHO AI】
こんな方におすすめです。
Liệt kê 4-5 dòng bullet (・) — mỗi dòng là một chân dung cụ thể của người xem phù hợp:
・[Tình trạng/vấn đề họ đang gặp — càng cụ thể càng tốt]

【BLOCK 3 — NỘI DUNG VIDEO】
この動画では、
[Giải thích ngắn 3-4 câu về những gì video này sẽ dạy — dùng ngôn ngữ ôn tồn, thận trọng, có chiều sâu triết học]

【BLOCK 4 — MỤC LỤC TIMESTAMPS】
▼目次
00:00 はじめに｜[Nội dung chương mở đầu]
XX:XX [Chương 2 — đặt tên theo đặc điểm/bài học thực tế trong kịch bản, không đặt chung chung kiểu "第1章"]
XX:XX [Chương 3]
(tiếp tục — mỗi bài học/đặc điểm chính là 1 chapter riêng)
XX:XX まとめ｜[Thông điệp kết]
(Giữ nguyên XX:XX — script Python sẽ tính và inject timestamps thực tế sau)

【BLOCK 5 — KÊNH + CTA】
▼このチャンネルについて
人生後半を穏やかに、賢く生きるための「処世訓」「先人の知恵」「人間関係の教訓」を、物語とともにお届けしています。

動画が心に残りましたら、チャンネル登録と高評価で応援していただけると励みになります。

[1 câu hỏi CTA — hỏi về trải nghiệm TỰ SỰ của khán giả, KHÔNG hỏi ý kiến chung. Câu hỏi phải liên quan trực tiếp đến chủ đề của video này. Ví dụ nếu video về nhận diện người xấu: "あなたが「距離を置いてよかった」と感じた人には、どんな特徴がありましたか？差し支えない範囲でコメントをお聞かせください。"]

【BLOCK 6 — DISCLAIMER + HASHTAGS】
※本動画は一般的な人生観・人間関係について考えるためのコンテンツです。個別の医療・心理・法律上の助言を目的とするものではありません。
※本動画では合成音声を使用しています。脚本・構成・編集は当チャンネル独自のものです。実在人物の発言や音声を再現するものではありません。

#人間関係 #人生哲学 #先人の知恵

━━━ PHẦN 2: TAGS YOUTUBE ━━━

【BLOCK 7 — TAGS 4 TẦNG】
Viết đúng format dưới đây (để script Python có thể parse):

TIER1_CORE: 処世訓, 人生哲学, 先人の知恵, 人間関係, 生き方, 人生後半
TIER2_TOPIC: [8-10 tags xoay vòng phù hợp chủ đề video này — ví dụ nếu video về nhận diện kẻ độc hại: 関わってはいけない人, 縁を切るべき人, 信用できない人, 人の本性, 本音を見抜く, 距離を置くべき人, 嫌な人の対処法, 人間関係を整理する]
TIER3_LONGTAIL: [5-8 tags long-tail đặc thù cho nội dung cụ thể của video này — ví dụ: 60代から関わってはいけない人, 信用できない人の口癖, 人の本性が出る瞬間]
TIER4_DEMO: 50代, 60代, 70代, シニア, 定年後

━━━ PHẦN 3: PINNED COMMENT ━━━

【BLOCK 8 — PINNED COMMENT】
📌 [1-2 dòng mô tả ngắn nội dung video]

💬 [1 câu hỏi "engagement dilemma" — câu hỏi lưỡng nan khó trả lời ngay, buộc khán giả phải suy nghĩ và chia sẻ. Liên quan trực tiếp chủ đề video. Ví dụ: "あなたの周りに「いつも助けてもらっているのに、なぜか疲れる人」はいますか？その人にはどんな特徴がありましたか？"]

👉 チャンネル登録で次の動画もお届けします

━━━ QUY TẮC ĐẦU RA ━━━
- TUYỆT ĐỐI KHÔNG có lời chào AI, không có "以下は" hay "承知しました" hay bất kỳ meta-commentary nào.
- Giữ đúng format BLOCK với header 【BLOCK X — ...】 để script parse.
- Timestamps dùng XX:XX làm placeholder — KHÔNG tự bịa timestamps.
- Hashtags CỐ ĐỊNH ở Block 6: đúng 3 thẻ #人間関係 #人生哲学 #先人の知恵
- TIER1_CORE không được thay đổi.
- Output sạch, sẵn sàng copy-paste."""

PROMPT_TURN5_IMAGE_BASE = """Bạn là chuyên gia thiết kế thumbnail YouTube tiếng Nhật có CTR rất cao, chuyên tạo thumbnail phong cách Nhật Bản dành cho khán giả trung niên và lớn tuổi, với cảm giác GAY GẮT, KHẲNG ĐỊNH, THÔ RÁP, DRAMA, CẢNH BÁO, gây sốc mạnh ngay trong 1 giây đầu tiên.

Hãy tạo một thumbnail YouTube hoàn chỉnh dựa trên:
- Hình ảnh nhân vật tôi đính kèm.
- Phần text thumbnail tiếng Nhật tôi dán ở cuối prompt.

MỤC TIÊU THIẾT KẾ
Thumbnail phải có cảm giác như một người đàn ông lớn tuổi đang quát thẳng vào người xem, cảnh cáo một điều cực kỳ nghiêm trọng, nói ra một chân lý cay nghiệt mà người xem không thể phớt lờ.
Không tạo cảm giác hiền lành, thân thiện, mỉm cười, giảng giải nhẹ nhàng hoặc bình thản.
Biểu cảm phải cực kỳ mạnh.
Người xem chỉ cần nhìn khuôn mặt nhân vật là phải cảm nhận được:
“Ông ấy đang cảnh cáo tôi.”
“Chuyện này cực kỳ nghiêm trọng.”
“Nếu không nghe, tôi sẽ phải trả giá.”

TỶ LỆ VÀ KÍCH THƯỚC
- Tỷ lệ chính xác 16:9.
- Chuẩn thumbnail YouTube.
- Bố cục tối ưu để nhìn rõ trên điện thoại.
- Độ tương phản cực cao.
- Chủ thể và chữ phải đọc được ngay khi thumbnail hiển thị ở kích thước nhỏ.

BỐ CỤC CỐ ĐỊNH
Bố cục này phải được giữ cố định cho tất cả video trong series.
NHÂN VẬT LUÔN NẰM BÊN PHẢI.
TEXT LUÔN NẰM BÊN TRÁI.
Không được đảo vị trí.

Nhân vật:
- Đặt sát phía bên phải thumbnail.
- Chiếm khoảng 35 đến 42 phần trăm chiều ngang.
- Crop từ khoảng ngực hoặc vai trở lên.
- Khuôn mặt phải lớn.
- Đầu nhân vật nằm gần khu vực góc phải phía trên nhưng không bị cắt đầu.
- Không để nhân vật quá nhỏ.
- Không đặt nhân vật chính giữa.
- Không để nhân vật che text.
- Có thể cho một phần vai hoặc bàn tay tiến vào vùng giữa thumbnail để tăng chiều sâu.

TEXT:
- Chiếm khoảng 58 đến 65 phần trăm diện tích phía bên trái.
- Chữ phải cực lớn.
- Ba dòng text phải phủ phần lớn không gian bên trái.
- Text phải được ưu tiên hơn các chi tiết trang trí.
- Không để text sát mép thumbnail.
- Không để chữ va vào khuôn mặt nhân vật.

PHONG CÁCH HÌNH ẢNH
- Japanese YouTube thumbnail.
- High CTR.
- Highly dramatic.
- Aggressive warning style.
- Strong emotional tension.
- High contrast. Bold. Rough. Serious. Authoritative. Visually explosive.
Thumbnail phải có cảm giác giống một lời cảnh báo nghiêm trọng, không phải một video kiến thức thông thường.

NỀN
Nền phải tối, dữ dội, có chiều sâu.
Tông chính: Đen, Đỏ sẫm, Đỏ lửa, Cam cháy, Vàng kim.
Có thể sử dụng: Khói đỏ đen, Tia lửa, Đốm lửa nhỏ, Texture cháy, Vệt sáng đỏ, Tia sáng chéo, Đường radial burst, Hiệu ứng nứt ánh sáng, Glow đỏ sau text, Glow vàng cam phía sau nhân vật, Texture grunge nhẹ.
Nền không được phẳng, phải tạo cảm giác như một tình huống đang bùng nổ. Không để nền quá rối, không che chữ. Không dùng phong cảnh đẹp, yên bình hay nền pastel.

ÁNH SÁNG NHÂN VẬT
- Có rim light vàng cam hoặc vàng kim quanh tóc, vai và cạnh khuôn mặt.
- Ánh sáng phía sau nhân vật tạo halo mạnh.
- Mặt phải sáng rõ hơn nền. Tăng contrast khuôn mặt, nếp nhăn, ánh mắt.

TEXT THUMBNAIL
Chỉ sử dụng đúng phần text tôi cung cấp ở cuối prompt. Không tự ý thay đổi nội dung, không thêm logo hay watermark.
TEXT BẮT BUỘC CHIA THÀNH ĐÚNG 3 DÒNG: Dòng 1 ở trên, Dòng 2 ở giữa, Dòng 3 ở dưới. Khoảng cách rõ ràng.

TYPOGRAPHY
Sử dụng font Japanese Gothic cực đậm (Ultra Bold, Heavy Gothic, Blocky, Thick, Aggressive).
Chữ phải rất lớn, rất dày, có viền đen cực dày và shadow đen mạnh, glow tương ứng.

MÀU TEXT CỐ ĐỊNH:
- DÒNG 1: Trắng sáng, viền đen cực dày, glow đỏ mạnh.
- DÒNG 2: Vàng chanh hoặc vàng kim cực sáng, viền đen cực dày, glow vàng nhẹ. (Nổi bật nhất).
- DÒNG 3: Đỏ tươi hoặc đỏ crimson mạnh, viền đen dày, glow đỏ mạnh. (Cảm giác nguy hiểm, hậu quả).
Tổng thể hệ màu: TRẮNG + VÀNG + ĐỎ + ĐEN.

KẾT QUẢ CUỐI CÙNG
Thumbnail cuối cùng phải giống một thumbnail YouTube Nhật Bản CTR cao:
- Nhân vật đàn ông lớn tuổi ở bên phải, nhíu mày mạnh, ánh mắt sắc, miệng đang quát / cảnh cáo.
- Text cực lớn ở bên trái (3 dòng: Trắng + Vàng + Đỏ).
- Nền đỏ đen cháy dữ dội.
- Tổng thể GAY GẮT, KHẲNG ĐỊNH, THÔ RÁP, DRAMA, CẢNH BÁO, CỰC KỲ CLICKBAIT.

PHẦN TEXT THUMBNAIL CẦN HIỂN THỊ:
{thumbnail_text}"""

PROMPT_TURN4_TEMPLATE = """Dựa trên tiêu đề vừa chọn, hãy đề xuất TEXT TRÊN THUMBNAIL (3 dòng tiếng Nhật) đạt CTR cao nhất.

QUY TẮC THUMBNAIL TEXT:
- DÒNG 1 (Trắng, cỡ lớn): Mô tả chủ thể/đối tượng chính — 4-7 ký tự. Ví dụ: 悪い人は / 本性は / 信じるな
- DÒNG 2 (Vàng, nổi bật nhất): Trạng thái/hành động/sự thật cốt lõi — 4-8 ký tự. Đây là dòng người xem nhìn đầu tiên. Ví dụ: 顔に出る / こう見抜く / ここに出る
- DÒNG 3 (Đỏ, cảm giác nguy hiểm): BẮT BUỘC là mệnh lệnh tiêu cực hoặc hậu quả — 4-7 ký tự:
  • Video nhận diện kẻ xấu/độc hại: dùng 近づくな / 信じるな / 逃げろ
  • Video cắt đứt quan hệ: dùng 縁を切れ / 離れろ / 距離を置け
  • Video bài học cuộc đời/hối tiếc: dùng 覚えておけ / 忘れるな / 気づけ
  • Video buông bỏ/sống thanh thản: dùng 手放せ / 執着を捨てろ

CHÚ Ý:
- Mỗi dòng tối đa 8 ký tự — đọc được ngay trên điện thoại màn hình nhỏ.
- KHÔNG thêm dấu câu thừa, không bọc trong 【】hay 「」.
- Chọn mệnh lệnh dòng 3 PHÙ HỢP với chủ đề của kịch bản vừa viết.

OUTPUT FORMAT BẮT BUỘC (3 dòng, không giải thích, không thêm gì khác):
Dòng 1: [text dòng 1]
Dòng 2: [text dòng 2]
Dòng 3: [text dòng 3]"""


# =============================================================================
# PARSERS — Turn 2 & Turn 3
# =============================================================================

def parse_turn2_result(raw_text: str) -> dict:
    """
    Parse 3 title variants A/B/C from Turn 2 ChatGPT response.
    Expected format:
        A: [title_a]
        B: [title_b]
        C: [title_c]
    Falls back to first Japanese-containing line as title_primary.
    """
    result = {"title_a": "", "title_b": "", "title_c": "", "title_primary": ""}
    for line in raw_text.splitlines():
        stripped = line.strip()
        if re.match(r'^A[:：]', stripped):
            result["title_a"] = re.sub(r'^A[:：]\s*', '', stripped).strip(' "`*')
        elif re.match(r'^B[:：]', stripped):
            result["title_b"] = re.sub(r'^B[:：]\s*', '', stripped).strip(' "`*')
        elif re.match(r'^C[:：]', stripped):
            result["title_c"] = re.sub(r'^C[:：]\s*', '', stripped).strip(' "`*')
    # Fallback: pick first non-empty line containing Japanese characters
    if not result["title_a"]:
        for line in raw_text.splitlines():
            line = line.strip().strip(' "`*')
            if line and re.search(r'[\u3040-\u30ff\u4e00-\u9fff]', line):
                result["title_a"] = line
                break
    result["title_primary"] = result["title_a"] or result["title_b"] or (raw_text.splitlines()[0].strip() if raw_text.splitlines() else "")
    return result


def parse_turn3_result(raw_text: str) -> dict:
    """
    Parse description, tags (tiered), pinned comment from Turn 3 response.
    Expects BLOCK markers: 【BLOCK 1 —】 through 【BLOCK 8 —】
    Also reads TIER1_CORE:, TIER2_TOPIC:, TIER3_LONGTAIL:, TIER4_DEMO: lines.
    Returns dict with keys:
        description_jp  - Blocks 1-6 joined (clean description ready for YouTube)
        tags_tiered     - {tier1, tier2, tier3, tier4} as lists
        tags_flat       - comma-separated string, all tiers merged, max 480 chars
        pinned_comment  - Block 8 text
        chapters_raw    - list of chapter timestamp lines from Block 4
    """
    # Split raw into blocks by 【BLOCK N or [BLOCK N
    block_texts: dict = {}
    current_block = 0
    buffer: list = []

    for line in raw_text.splitlines():
        m = re.match(r'[【\[]?BLOCK\s+(\d+)', line, re.IGNORECASE)
        if m:
            if current_block > 0:
                block_texts[current_block] = "\n".join(buffer).strip()
            current_block = int(m.group(1))
            buffer = []
        else:
            if current_block > 0:
                buffer.append(line)
    if current_block > 0:
        block_texts[current_block] = "\n".join(buffer).strip()

    # Graceful degradation: no BLOCK markers found
    if not block_texts:
        logger.warning("parse_turn3_result: No BLOCK markers found, returning raw text as description.")
        return {
            "description_jp": raw_text.strip(),
            "tags_tiered": {"tier1": [], "tier2": [], "tier3": [], "tier4": []},
            "tags_flat": "",
            "pinned_comment": "",
            "chapters_raw": [],
        }

    # Build description from blocks 1-6, stripping Vietnamese instruction hints
    INSTRUCTION_PATTERNS = re.compile(
        r'(Format:|Liệt kê|Ví dụ|tiếp tục|Giải thích|Giữ nguyên XX|câu hỏi|Tình huống|Lý do khẩn)',
        re.IGNORECASE
    )
    desc_parts = []
    for bn in range(1, 7):
        if bn in block_texts:
            text = block_texts[bn]
            cleaned_lines = [ln for ln in text.splitlines() if not INSTRUCTION_PATTERNS.search(ln)]
            text = "\n".join(cleaned_lines).strip()
            if text:
                desc_parts.append(text)
    description_jp = "\n\n".join(desc_parts).strip()

    # Parse tags from block 7 (TIER lines) — also scan full raw as fallback
    tags_tiered: dict = {"tier1": [], "tier2": [], "tier3": [], "tier4": []}
    tier_search_text = block_texts.get(7, "") or raw_text
    tier_patterns = [
        ("tier1", re.compile(r'TIER1(?:_CORE)?[:：]\s*(.+)', re.IGNORECASE)),
        ("tier2", re.compile(r'TIER2(?:_TOPIC)?[:：]\s*(.+)', re.IGNORECASE)),
        ("tier3", re.compile(r'TIER3(?:_LONGTAIL)?[:：]\s*(.+)', re.IGNORECASE)),
        ("tier4", re.compile(r'TIER4(?:_DEMO)?[:：]\s*(.+)', re.IGNORECASE)),
    ]
    for line in tier_search_text.splitlines():
        for tier_key, pattern in tier_patterns:
            m = pattern.match(line.strip())
            if m:
                tags = [t.strip() for t in m.group(1).split(',') if t.strip()]
                tags_tiered[tier_key] = tags
                break

    # Build flat tags: all tiers merged, deduped, max 480 chars
    all_tags: list = []
    seen: set = set()
    for tier in ["tier1", "tier2", "tier3", "tier4"]:
        for tag in tags_tiered[tier]:
            if tag not in seen:
                seen.add(tag)
                all_tags.append(tag)
    tags_flat_parts: list = []
    char_count = 0
    for tag in all_tags:
        addition = len(tag) + 2  # +2 for ", "
        if char_count + addition > 480:
            break
        tags_flat_parts.append(tag)
        char_count += addition
    tags_flat = ", ".join(tags_flat_parts)

    # Extract chapter lines from block 4
    chapters_raw: list = []
    for ln in block_texts.get(4, "").splitlines():
        if re.match(r'^(?:00:00|XX:XX|\d{2}:\d{2})', ln.strip()):
            chapters_raw.append(ln.strip())

    # Extract and clean pinned comment from block 8
    pinned_lines = []
    for ln in block_texts.get(8, "").splitlines():
        if re.search(r'(câu hỏi|Liên quan|Ví dụ|buộc khán giả|dòng mô tả)', ln):
            continue
        pinned_lines.append(ln)
    pinned_comment = "\n".join(pinned_lines).strip()

    return {
        "description_jp": description_jp,
        "tags_tiered": tags_tiered,
        "tags_flat": tags_flat,
        "pinned_comment": pinned_comment,
        "chapters_raw": chapters_raw,
    }


async def ensure_thinking_effort_high(page: Page) -> None:
    logger.info("Checking Thinking effort setting (target: High)...")
    effort_btn_selectors = [
        'button:has-text("Thinking effort")',
        'button:has-text("Effort")',
        'button:has-text("High")',
        'button:has-text("Medium")',
        'button:has-text("Low")',
        'button:has-text("Instant")',
    ]
    target_btn = None
    for sel in effort_btn_selectors:
        loc = page.locator(sel)
        for i in range(await loc.count()):
            btn = loc.nth(i)
            if await btn.is_visible():
                target_btn = btn
                break
        if target_btn:
            break
            
    if target_btn:
        label = (await target_btn.inner_text()).strip()
        logger.info(f"Effort control found: '{label}'")
        await target_btn.click()
        await asyncio.sleep(0.4)
        
        high_option = page.locator('text="High"').first
        if await high_option.is_visible():
            await high_option.click()
            await asyncio.sleep(0.3)
            
        slider = page.locator('[role="slider"]').first
        if await slider.is_visible():
            box = await slider.bounding_box()
            if box:
                await page.mouse.click(box["x"] + box["width"] + 50, box["y"] + box["height"] / 2)
                await asyncio.sleep(0.3)
                
        await page.keyboard.press("Escape")
        await asyncio.sleep(0.3)


async def set_composer_text(page: Page, message: str) -> None:
    """
    Safely insert text into ChatGPT's contenteditable #prompt-textarea.
    Avoids Playwright's locator.fill() timeout bug on large ProseMirror content.
    """
    prompt_input = page.locator(PROMPT_INPUT_SELECTOR).first
    await prompt_input.wait_for(state="visible", timeout=30000)
    await prompt_input.click()
    await asyncio.sleep(0.2)
    
    # Clear any existing text
    await page.keyboard.press("Control+A")
    await page.keyboard.press("Backspace")
    await asyncio.sleep(0.2)
    
    pasted = False
    try:
        # Write to clipboard via page.evaluate
        await page.evaluate("text => navigator.clipboard.writeText(text)", message)
        await page.keyboard.press("Control+V")
        await asyncio.sleep(0.5)
        val = await prompt_input.evaluate("node => node.innerText || node.textContent || ''")
        if len(val.strip()) > 0:
            pasted = True
            logger.info(f"Pasted {len(message)} chars into composer via clipboard.")
    except Exception as e:
        logger.warning(f"Clipboard paste attempt failed: {e}")
        
    if not pasted:
        logger.info("Using keyboard.insert_text fallback...")
        await prompt_input.focus()
        await page.keyboard.insert_text(message)
        await asyncio.sleep(0.5)


async def submit_prompt(page: Page, timeout_seconds: int = 15) -> None:
    """
    Ensure the prompt in the composer is submitted.
    Tries clicking send button and Enter key until composer is cleared.
    """
    prompt_input = page.locator(PROMPT_INPUT_SELECTOR).first
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while asyncio.get_running_loop().time() < deadline:
        val = await prompt_input.evaluate("el => (el.innerText || el.textContent || '').trim()")
        if not val:
            logger.info("Prompt submission confirmed (composer is empty).")
            return

        for sel in SEND_SELECTORS:
            btn = page.locator(sel).first
            if await btn.is_visible():
                try:
                    aria_disabled = (await btn.get_attribute("aria-disabled")) == "true"
                    disabled = await btn.is_disabled()
                    if not aria_disabled and not disabled:
                        await btn.click()
                        await asyncio.sleep(0.6)
                        val_after = await prompt_input.evaluate("el => (el.innerText || el.textContent || '').trim()")
                        if not val_after:
                            logger.info("Prompt submission confirmed after clicking send button.")
                            return
                except Exception:
                    pass
        await prompt_input.focus()
        await page.keyboard.press("Enter")
        await asyncio.sleep(0.5)


GET_LATEST_ASSISTANT_TEXT_SCRIPT = """
() => {
    // 1. Standard selector
    const roleNodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    if (roleNodes.length > 0) {
        const last = roleNodes[roleNodes.length - 1];
        return last.innerText || last.textContent || "";
    }
    
    // 2. Find by 'You said:' boundaries
    const all = Array.from(document.querySelectorAll('*'));
    const userSaidNodes = all.filter(el => el.textContent.trim() === 'You said:' && el.children.length === 0);
    if (userSaidNodes.length > 0) {
        const lastUser = userSaidNodes[userSaidNodes.length - 1];
        let userBlock = lastUser;
        while (userBlock && userBlock.parentElement && userBlock.parentElement.children.length === 1) {
            userBlock = userBlock.parentElement;
        }
        const userTurn = userBlock.parentElement;
        let assistantTurn = userTurn ? userTurn.nextElementSibling : null;
        if (assistantTurn) {
            let txt = assistantTurn.innerText || "";
            txt = txt.replace(/^ChatGPT said:\s*/i, "").trim();
            return txt;
        }
    }
    return "";
}
"""


async def send_chatgpt_message(page: Page, message: str, timeout_seconds: int = 400) -> str:
    prompt_input = page.locator(PROMPT_INPUT_SELECTOR).first
    await prompt_input.wait_for(state="visible", timeout=30000)
    
    stop_btn = page.locator(STOP_SELECTOR).first
    wait_stop_deadline = asyncio.get_running_loop().time() + 30
    while await stop_btn.is_visible() and asyncio.get_running_loop().time() < wait_stop_deadline:
        await asyncio.sleep(1)

    previous_text = (await page.evaluate(GET_LATEST_ASSISTANT_TEXT_SCRIPT) or "").strip()
    
    await set_composer_text(page, message)
    await asyncio.sleep(0.4)
    await submit_prompt(page)
    logger.info("Message sent. Waiting for generation to start...")
    
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    started = False
    while asyncio.get_running_loop().time() < deadline:
        stop_count = await page.locator(STOP_SELECTOR).count()
        curr_text = (await page.evaluate(GET_LATEST_ASSISTANT_TEXT_SCRIPT) or "").strip()
        if stop_count > 0 or (curr_text and curr_text != previous_text):
            started = True
            break
        await asyncio.sleep(1)
        
    if not started:
        raise TimeoutError("ChatGPT did not begin responding within timeout.")
        
    logger.info("Assistant is generating/thinking...")
    last_text = ""
    stable_count = 0
    
    while asyncio.get_running_loop().time() < deadline:
        stop_visible = False
        try:
            stop_visible = await page.locator(STOP_SELECTOR).first.is_visible()
        except Exception:
            pass
            
        curr_text = (await page.evaluate(GET_LATEST_ASSISTANT_TEXT_SCRIPT) or "").strip()
        curr_text = re.sub(r"^(?:thought for \d+\s*(?:s|sec|seconds)|thinking process:?[\s\S]*?\n\n)", "", curr_text, flags=re.I).strip()
        
        if curr_text and curr_text != previous_text and curr_text == last_text and not stop_visible:
            stable_count += 1
            if stable_count >= 3:
                logger.info("Generation finished and stabilized.")
                break
        else:
            stable_count = 0
        last_text = curr_text
            
        await asyncio.sleep(2)
        
    return last_text.strip()


async def generate_thumbnail_image_turn(page: Page, image_prompt: str, base_image_path: str, timeout_seconds: int = 300) -> Optional[str]:
    """
    Turn 5:
    1. Upload base image (phoi-ko-jp.png) to composer.
    2. Paste full image prompt.
    3. Submit prompt and wait for DALL-E image generation to complete.
    4. Download generated image to public/thumbnails/ and return relative URL.
    """
    logger.info(f"[TURN 5/5] Starting Thumbnail generation with base image: {base_image_path}")
    path_obj = Path(base_image_path).resolve()
    if not path_obj.exists():
        logger.error(f"Base image not found at {path_obj}")
        return None

    prompt_input = page.locator(PROMPT_INPUT_SELECTOR).first
    await prompt_input.wait_for(state="visible", timeout=30000)

    # 1. Upload base image attachment
    logger.info(f"Uploading base image attachment: {path_obj}")
    target_input = page.locator('input[type="file"][accept*="image"]').first
    if await target_input.count() > 0:
        await target_input.set_input_files(str(path_obj))
    else:
        file_input = page.locator(FILE_INPUT_SELECTOR).first
        await file_input.set_input_files(str(path_obj))

    # Wait for attachment preview in composer
    logger.info("Waiting for attachment preview in composer...")
    for _ in range(30):
        preview = page.locator('form img, [data-testid*="attachment"], [aria-label*="Remove"]').first
        if await preview.is_visible():
            logger.info("Attachment preview confirmed in composer!")
            break
        await asyncio.sleep(0.5)

    # 2. Paste Turn 5 image prompt
    logger.info(f"Inserting Turn 5 image prompt ({len(image_prompt)} chars)...")
    await set_composer_text(page, image_prompt)
    await asyncio.sleep(0.8)

    previous_count = await page.locator(ASSISTANT_SELECTOR).count()
    await submit_prompt(page)
    logger.info("Image prompt submitted. Waiting for ChatGPT DALL-E generation...")

    # 3. Wait for response to start
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while asyncio.get_running_loop().time() < deadline:
        curr_count = await page.locator(ASSISTANT_SELECTOR).count()
        stop_count = await page.locator(STOP_SELECTOR).count()
        if curr_count > previous_count or stop_count > 0:
            break
        await asyncio.sleep(1)

    # 4. Wait for image to render on page
    logger.info("Waiting for generated thumbnail image to appear on page...")
    img_src = None
    target_img_element = None
    while asyncio.get_running_loop().time() < deadline:
        stop_visible = False
        try:
            stop_visible = await page.locator(STOP_SELECTOR).first.is_visible()
        except Exception:
            pass

        # Scroll to bottom so virtualized list mounts the generated image
        try:
            scroll_btn = page.locator('button:has-text("↓"), [aria-label*="Scroll to bottom"]').first
            if await scroll_btn.is_visible():
                await scroll_btn.click()
            else:
                await page.mouse.wheel(0, 5000)
        except Exception:
            pass

        # Look for the generated image (avoiding the uploaded phoi-ko-jp base image)
        candidate_selectors = [
            'img[alt^="Generated image"]',
            'img[src*="/estuary/content"]:not([alt*="phoi"])',
            'img[src*="oaiusercontent"]:not([alt*="phoi"])',
            'img[src*="dalle"]:not([alt*="phoi"])',
        ]
        for sel in candidate_selectors:
            loc = page.locator(sel)
            if await loc.count() > 0:
                img = loc.last
                src = await img.get_attribute("src")
                if src and not stop_visible:
                    img_src = src
                    target_img_element = img
                    logger.info(f"Generated thumbnail image found via '{sel}': {img_src[:80]}...")
                    break
        if img_src:
            break

        await asyncio.sleep(4)

    if not img_src and not target_img_element:
        logger.warning("Could not find generated image in response.")
        return None

    # 5. Save image to web_ko_jp/public/thumbnails/
    out_filename = f"thumb_{int(asyncio.get_running_loop().time())}.png"
    out_dir = Path(r"D:\VibeCoding\auto_YT\web_ko_jp\public\thumbnails")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / out_filename

    FETCH_AS_DATA_URL = """
    async (url) => {
        const resp = await fetch(url);
        const blob = await resp.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    """

    saved = False
    try:
        if img_src and img_src.startswith("data:image"):
            header, data = img_src.split(",", 1)
            out_path.write_bytes(base64.b64decode(data))
            saved = True
        elif img_src:
            logger.info(f"Fetching image data via browser context: {img_src[:80]}...")
            data_url = await page.evaluate(FETCH_AS_DATA_URL, img_src)
            if data_url and data_url.startswith("data:image"):
                header, data = data_url.split(",", 1)
                out_path.write_bytes(base64.b64decode(data))
                saved = True
                logger.info(f"Saved generated thumbnail to {out_path} ({out_path.stat().st_size} bytes)")
    except Exception as e:
        logger.warning(f"In-browser fetch failed: {e}")

    if not saved and target_img_element:
        try:
            await target_img_element.screenshot(path=str(out_path))
            saved = True
            logger.info(f"Saved generated thumbnail via element screenshot to {out_path}")
        except Exception as e:
            logger.error(f"Element screenshot failed: {e}")

    if saved and out_path.exists() and out_path.stat().st_size > 1000:
        return f"/thumbnails/{out_filename}"
    else:
        logger.error("Failed to save valid thumbnail image file.")
        return None


def is_japanese_line(line: str) -> bool:
    """Check if line contains Japanese characters (Hiragana, Katakana, Kanji)."""
    return bool(re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", line))


def clean_thumbnail_line(line: str) -> str:
    """Clean markdown, numbering, or prefixes from a thumbnail line."""
    cleaned = re.sub(r"^(?:dòng\s*\d+|line\s*\d+|\d+行目|\d+[\.:\-])\s*[:：\-]?\s*", "", line, flags=re.I)
    cleaned = cleaned.strip(" `*\"'「」『』#")
    return cleaned.strip()


def parse_thumbnail_response(raw_text: str) -> Tuple[str, List[str]]:
    raw_lines = [clean_thumbnail_line(line) for line in raw_text.splitlines() if line.strip()]
    chosen_lines = []
    options = []
    
    match_strong = re.search(
        r"(?:Mẫu mạnh nhất|Đề xuất mạnh nhất|Chốt|おすすめ|決定稿)[^\n:]*[:：]?\s*\n+([\s\S]*?)(?=(?:Một số phương án|Phương án khác|Các phương án|\d+\.|\Z))",
        raw_text,
        re.IGNORECASE,
    )
    if match_strong:
        strong_block = match_strong.group(1).strip()
        strong_lines = [clean_thumbnail_line(l) for l in strong_block.splitlines() if clean_thumbnail_line(l)]
        jp_strong_lines = [l for l in strong_lines if is_japanese_line(l)]
        if jp_strong_lines:
            chosen_lines = jp_strong_lines[:3]
            
    option_blocks = re.findall(r"(?:\d+\.\s*)([\s\S]*?)(?=(?:\d+\.\s*|\Z))", raw_text)
    for opt in option_blocks:
        clean_opt_lines = [clean_thumbnail_line(l) for l in opt.splitlines() if clean_thumbnail_line(l) and is_japanese_line(l)]
        if clean_opt_lines:
            options.append("\n".join(clean_opt_lines[:3]))
            
    if not chosen_lines:
        candidates = [l for l in raw_lines if is_japanese_line(l)]
        if candidates:
            chosen_lines = candidates[:3]
        
    chosen_text = "\n".join(chosen_lines)
    return chosen_text, options


async def execute_full_drama_workflow(
    title: str,
    url: str,
    transcript: str,
    generate_image: bool = True,
    synthesize_audio: bool = False,
    base_image_path: str = r"D:\VibeCoding\auto_YT\web_ko_jp\phoi-ko-jp.png",
    timeout_seconds: int = 600,
) -> Dict[str, Any]:
    profile_dir = gpt_profile_dir()
    if not profile_dir.exists():
        raise RuntimeError(f"Profile directory does not exist: {profile_dir}")
        
    logger.info(f"Opening Playwright persistent context: {profile_dir}")
    async with async_playwright() as p:
        context: BrowserContext = await p.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=False,
            channel="chrome",
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--start-maximized",
            ],
            permissions=["clipboard-read", "clipboard-write"],
            no_viewport=True,
            timeout=45000,
        )
        
        page: Page = context.pages[0] if context.pages else await context.new_page()
        
        logger.info(f"Navigating to {CHATGPT_URL}...")
        await page.goto(CHATGPT_URL, wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(2)
        
        # Start new clean chat if needed
        try:
            new_chat_btn = page.locator(NEW_CHAT_SELECTOR).first
            if await new_chat_btn.is_visible(timeout=2000):
                await new_chat_btn.click(force=True, timeout=3000)
                await asyncio.sleep(1)
        except Exception as e:
            logger.info(f"New chat button click bypassed: {e}")
            
        await page.locator(PROMPT_INPUT_SELECTOR).first.wait_for(state="visible", timeout=30000)
        
        # Ensure Thinking effort is High
        try:
            await ensure_thinking_effort_high(page)
        except Exception as e:
            logger.warning(f"Could not adjust Thinking effort: {e}")

        # TURN 1: Kịch bản tiếng Nhật
        logger.info("[TURN 1/5] Generating Japanese drama script...")
        prompt_turn1 = PROMPT_TURN1_TEMPLATE.format(title=title, url=url, transcript=transcript)
        script_jp = await send_chatgpt_message(page, prompt_turn1, timeout_seconds=timeout_seconds)
        logger.info(f"[TURN 1 DONE] Script length: {len(script_jp)} chars.")
        await asyncio.sleep(2)

        # TURN 2: Title — 3 variants A/B/C, SEO JP
        logger.info("[TURN 2/5] Generating Japanese title variants (A/B/C)...")
        raw_title_response = await send_chatgpt_message(page, PROMPT_TURN2_TEMPLATE, timeout_seconds=180)
        title_parsed = parse_turn2_result(raw_title_response)
        title_jp = title_parsed["title_primary"]
        logger.info(f"[TURN 2 DONE] Title A: {title_parsed['title_a']}")
        logger.info(f"              Title B: {title_parsed['title_b']}")
        logger.info(f"              Title C: {title_parsed['title_c']}")
        await asyncio.sleep(2)

        # TURN 3: Description (8 blocks) + Tags (4 tiers) + Pinned Comment
        logger.info("[TURN 3/5] Generating description, tags, pinned comment...")
        raw_description_response = await send_chatgpt_message(page, PROMPT_TURN3_TEMPLATE, timeout_seconds=300)
        turn3_parsed = parse_turn3_result(raw_description_response)
        description_jp = turn3_parsed["description_jp"]
        youtube_tags = turn3_parsed["tags_flat"]
        tags_tiered = turn3_parsed["tags_tiered"]
        pinned_comment = turn3_parsed["pinned_comment"]
        chapters_raw = turn3_parsed["chapters_raw"]
        logger.info(
            f"[TURN 3 DONE] Description: {len(description_jp)} chars. "
            f"Tags: {len(youtube_tags.split(','))} total. "
            f"Chapters: {len(chapters_raw)}. "
            f"Pinned comment: {'YES' if pinned_comment else 'NO'}."
        )
        await asyncio.sleep(2)

        # TURN 4: Thumbnail text — 3 lines with formula heuristic
        logger.info("[TURN 4/5] Generating 3-line thumbnail text with formula heuristic...")
        raw_thumb_response = await send_chatgpt_message(page, PROMPT_TURN4_TEMPLATE, timeout_seconds=180)
        chosen_thumb_text, thumb_options = parse_thumbnail_response(raw_thumb_response)
        logger.info(f"[TURN 4 DONE] Chosen Thumbnail Text:\n{chosen_thumb_text}")
        await asyncio.sleep(2)

        # TURN 5: Tạo ảnh Thumbnail hoàn chỉnh (@Create image)
        thumbnail_image_url = None
        if generate_image:
            logger.info("[TURN 5/5] Creating complete Thumbnail Image via @Create image...")
            image_prompt = PROMPT_TURN5_IMAGE_BASE.format(thumbnail_text=chosen_thumb_text)
            try:
                thumbnail_image_url = await generate_thumbnail_image_turn(
                    page=page,
                    image_prompt=image_prompt,
                    base_image_path=base_image_path,
                    timeout_seconds=240,
                )
            except Exception as e:
                logger.error(f"[TURN 5 ERROR] Thumbnail image generation failed: {e}")

        conversation_url = page.url
        logger.info(f"All workflow turns completed in session: {conversation_url}")
        
        await context.close()

        # AUDIO TTS: Tùy chọn sinh audio lồng tiếng bằng GPT-SoVITS
        audio_url = None
        if synthesize_audio and script_jp:
            try:
                from tts_gpt_sovits import generate_japanese_narration
                logger.info("[AUDIO TTS] Synthesizing Japanese drama narration via GPT-SoVITS...")
                audio_file = generate_japanese_narration(
                    text=script_jp,
                    title=title,
                    source_url=url,
                )
                audio_url = f"/api/audio?file={Path(audio_file).name}"
                logger.info(f"[AUDIO TTS DONE] Audio file ready at: {audio_url}")
            except Exception as tts_err:
                logger.error(f"[AUDIO TTS ERROR] Audio synthesis failed: {tts_err}")
        
        return {
            "title": title,
            "url": url,
            "conversation_url": conversation_url,
            # Title variants
            "title_jp": title_jp,
            "title_a_jp": title_parsed["title_a"],
            "title_b_jp": title_parsed["title_b"],
            "title_c_jp": title_parsed["title_c"],
            # Script
            "script_jp": script_jp,
            # Description & metadata
            "description_jp": description_jp,
            "youtube_tags": youtube_tags,
            "tags_tiered": tags_tiered,
            "pinned_comment": pinned_comment,
            "chapters_raw": chapters_raw,
            # Thumbnail
            "thumbnail_text": chosen_thumb_text,
            "thumbnail_options": thumb_options,
            "thumbnail_image_url": thumbnail_image_url,
            # Audio
            "audio_url": audio_url,
            "char_count": len(script_jp),
        }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python chatgpt_drama_pipeline.py <youtube_url>")
        sys.exit(1)
        
    yt_url = sys.argv[1]
    
    from youtube_extractor import extract_youtube_info
    print(f"[pipeline] Extracting YouTube metadata and transcript for {yt_url}...")
    yt_data = extract_youtube_info(yt_url)
    
    res = asyncio.run(execute_full_drama_workflow(
        title=yt_data["title"],
        url=yt_data["url"],
        transcript=yt_data["transcript"],
    ))
    
    out_json = json.dumps(res, ensure_ascii=False, indent=2)
    print(out_json)