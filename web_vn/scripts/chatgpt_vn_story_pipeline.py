# -*- coding: utf-8 -*-
"""
Playwright ChatGPT Pipeline for Vietnamese Audio Drama (Sâm Kể Chuyện Style)
Robust multi-turn generation with context preservation and DOM-resilient polling.
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
logger = logging.getLogger("chatgpt_vn_story")

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from auto_yt.paths import gpt_profile_dir
from playwright.async_api import async_playwright, Page, BrowserContext

CHATGPT_URL = "https://chatgpt.com/"
PROMPT_INPUT_SELECTOR = "#prompt-textarea"
STOP_SELECTOR = 'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label*="Stop"]'
SEND_SELECTORS = (
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[aria-label*="Send"]',
)
NEW_CHAT_SELECTOR = '[data-testid="create-new-chat-button"], a[href="/"]'
CONTINUE_SELECTOR = 'button:has-text("Continue generating"), button:has-text("Tiếp tục"), button[data-testid*="continue"]'

GET_LAST_ASSISTANT_TEXT_SCRIPT = """
() => {
  const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
  if (!msgs || msgs.length === 0) return '';
  const node = msgs[msgs.length - 1];
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

class ChatGPTStoryPipeline:
    def __init__(self, headless: bool = False):
        self.headless = headless
        self.profile_dir = gpt_profile_dir()
        self.playwright = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None

    async def start(self):
        logger.info(f"Opening Chromium with profile: {self.profile_dir}")
        self.playwright = await async_playwright().start()
        self.context = await self.playwright.chromium.launch_persistent_context(
            user_data_dir=str(self.profile_dir),
            headless=self.headless,
            channel="chrome",
            viewport={"width": 1280, "height": 900},
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage"
            ]
        )
        self.page = self.context.pages[0] if self.context.pages else await self.context.new_page()
        await self.page.goto(CHATGPT_URL, wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(3)
        logger.info("ChatGPT page loaded successfully.")

    async def stop(self):
        if self.context:
            await self.context.close()
        if self.playwright:
            await self.playwright.stop()
        logger.info("Playwright session closed.")

    async def new_chat(self):
        try:
            new_chat_btn = self.page.locator(NEW_CHAT_SELECTOR).first
            if await new_chat_btn.is_visible(timeout=3000):
                await new_chat_btn.click()
                await asyncio.sleep(2)
                logger.info("Started fresh ChatGPT conversation.")
        except Exception as e:
            logger.debug(f"New chat click notice: {e}")

    async def send_prompt_and_wait(self, prompt_text: str, turn_name: str, max_wait_sec: int = 420) -> str:
        logger.info(f"--- Sending Prompt [{turn_name}] ({len(prompt_text)} chars) ---")
        textarea = self.page.locator(PROMPT_INPUT_SELECTOR).first
        await textarea.wait_for(state="visible", timeout=30000)
        
        await textarea.click()
        await self.page.evaluate(
            """(text) => {
                const el = document.querySelector('#prompt-textarea');
                if (el) {
                    el.focus();
                    document.execCommand('insertText', false, text);
                }
            }""",
            prompt_text
        )
        await asyncio.sleep(1)

        initial_msg_count = await self.page.evaluate(
            "() => document.querySelectorAll('[data-message-author-role=\"assistant\"]').length"
        )

        send_clicked = False
        for sel in SEND_SELECTORS:
            btn = self.page.locator(sel).first
            if await btn.is_visible(timeout=1000):
                await btn.click()
                send_clicked = True
                break
        if not send_clicked:
            await textarea.press("Enter")

        logger.info(f"Prompt sent. Waiting for generation to complete (max {max_wait_sec}s)...")
        await asyncio.sleep(4)

        # Wait for new assistant message to appear
        for _ in range(40):
            current_count = await self.page.evaluate(
                "() => document.querySelectorAll('[data-message-author-role=\"assistant\"]').length"
            )
            if current_count > initial_msg_count:
                break
            await asyncio.sleep(1)

        stable_count = 0
        last_text_len = 0
        for sec in range(0, max_wait_sec, 3):
            await asyncio.sleep(3)
            
            try:
                stop_btn = self.page.locator(STOP_SELECTOR).first
                is_generating = await stop_btn.is_visible(timeout=500)
            except Exception:
                is_generating = False

            # Check if there is a "Continue generating" button
            try:
                continue_btn = self.page.locator(CONTINUE_SELECTOR).first
                if await continue_btn.is_visible(timeout=500):
                    logger.info(f"[{turn_name}] 'Continue generating' button detected. Clicking to resume stream...")
                    await continue_btn.click()
                    await asyncio.sleep(2)
                    stable_count = 0
                    continue
            except Exception:
                pass

            try:
                current_text = await self.page.evaluate(GET_LAST_ASSISTANT_TEXT_SCRIPT)
            except Exception as e:
                logger.debug(f"Evaluation retry: {e}")
                continue

            current_len = len(current_text)

            if not is_generating:
                if current_len == last_text_len and current_len > 100:
                    stable_count += 1
                    if stable_count >= 2:
                        logger.info(f"[{turn_name}] Generation complete! Total length: {current_len:,} chars.")
                        return current_text
                else:
                    stable_count = 0
            
            last_text_len = current_len
            if sec % 15 == 0:
                logger.info(f"[{turn_name}] Streaming in progress... ({current_len:,} chars received)")

        return await self.page.evaluate(GET_LAST_ASSISTANT_TEXT_SCRIPT)

    async def execute_full_story_pipeline(self, topic_seed: Dict[str, Any], output_dir: Path) -> Dict[str, Any]:
        output_dir.mkdir(parents=True, exist_ok=True)
        results = {}

        # ----------------------------------------------------
        # TURN 1: Master Blueprint & 10-Chapter Outline
        # ----------------------------------------------------
        t1_file = output_dir / "turn1_blueprint.md"
        if t1_file.exists() and len(t1_file.read_text(encoding="utf-8")) > 500:
            logger.info("Found existing Turn 1 Blueprint. Reusing...")
            turn1_res = t1_file.read_text(encoding="utf-8")
            # If Turn 2 is not yet completed, prime current ChatGPT session with the Blueprint
            t2_file_check = output_dir / "turn2_chapters_1_4.md"
            if not (t2_file_check.exists() and len(t2_file_check.read_text(encoding="utf-8")) > 500):
                await self.new_chat()
                prime_prompt = f"""Dưới đây là MASTER BLUEPRINT VÀ DÀN Ý 10 CHƯƠNG ĐÃ ĐƯỢC PHÊ DUYỆT cho bộ truyện audio dài 30.000 từ phong cách "Sâm Kể Chuyện":

{turn1_res}

Hãy ghi nhớ toàn bộ thông tin nhân vật, 5 hồi kịch bản và 10 chương này. Hãy trả lời ngắn gọn: 'ĐÃ NẮM RÕ MASTER BLUEPRINT' để chúng ta bắt đầu viết chi tiết từng chương."""
                await self.send_prompt_and_wait(prime_prompt, "Prime Session with Blueprint", max_wait_sec=60)
        else:
            await self.new_chat()
            t1_prompt = f"""Bạn là chuyên gia biên kịch hàng đầu cho các chương trình truyện audio tâm sự, drama gia đình dài 2.5 giờ trên YouTube (phong cách kênh "Sâm Kể Chuyện").

Dựa trên hạt mầm đề tài sau:
- Thân phận nhân vật chính: {topic_seed.get('archetype', 'Thiếu tá Điều tra')}
- Sự hy sinh ban đầu: {topic_seed.get('sacrifice', 'Bán toàn bộ của hồi môn và vàng cưới của mẹ đẻ để lo vốn cho chồng lập nghiệp')}
- Hành vi áp bức / Bạc bẽo: {topic_seed.get('oppression', 'Chồng rước Tiểu tam có bầu về nhà, ép vợ ra đi tay trắng trong đêm mưa')}
- Bí mật lật kèo: {topic_seed.get('plot_secret', 'Căn nhà 12 tỷ thực chất đứng tên riêng do bố mẹ đẻ mua từ trước ngày cưới')}
- Cán cân công lý / Trả giá: {topic_seed.get('retribution', 'Cảnh sát ập vào phòng công chứng bắt giữ Tiểu tam và Chồng vì tội lừa đảo 15 tỷ')}
- Bài học đạo lý: {topic_seed.get('moral', 'Giá trị của người phụ nữ không nằm ở sự cam chịu, mà là dũng cảm sống vì sự thật và phẩm giá')}

HÃY LẬP BẢN MASTER BLUEPRINT VÀ DÀN Ý 10 CHƯƠNG CHI TIẾT (CHUẨN BỊ CHO BỘ TRUYỆN DÀI 30.000 TỪ):

Yêu cầu cấu trúc:
1. TIÊU ĐỀ CHÍNH (Giật gân, có chấm lách kiểm duyệt từ khóa nhạy cảm).
2. HỒ SƠ NHÂN VẬT (Tên tuổi, nghề nghiệp, tính cách của các nhân vật).
3. KHUNG 5 HỒI KỊCH BẢN (Tóm tắt cốt lõi từng hồi từ Hồi 1 đến Hồi 5).
4. DÀN Ý 10 CHƯƠNG CHI TIẾT (Tên chương, Hồi thuộc về, Mục tiêu kịch tính, Sự kiện chính xảy ra).

OUTPUT: Xuất nội dung Blueprint sạch sẽ, văn phong tiếng Việt chuẩn mực."""
            turn1_res = await self.send_prompt_and_wait(t1_prompt, "Turn 1: Master Blueprint")
            t1_file.write_text(turn1_res, encoding="utf-8")

        results["turn1_blueprint"] = turn1_res

        # ----------------------------------------------------
        # TURN 2: Chapters 1 to 4 (~9,000 words)
        # ----------------------------------------------------
        t2_file = output_dir / "turn2_chapters_1_4.md"
        if t2_file.exists() and len(t2_file.read_text(encoding="utf-8")) > 500:
            logger.info("Found existing Turn 2 Chapters. Reusing...")
            turn2_res = t2_file.read_text(encoding="utf-8")
        else:
            t2_prompt = """Tuyệt vời! Bây giờ dựa trên Master Blueprint đã duyệt ở trên, bạn hãy viết TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 4 CHƯƠNG ĐẦU TIÊN (Chương 1, Chương 2, Chương 3, Chương 4) với tổng dung lượng khoảng 8.000 - 10.000 từ.

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
4. DUNG LƯỢNG: Viết cực kỳ chi tiết, chậm rãi, đầy đặn từng phân cảnh, không được tóm tắt lướt qua. Hãy viết đầy đủ từng chương từ Chương 1 đến hết Chương 4."""
            turn2_res = await self.send_prompt_and_wait(t2_prompt, "Turn 2: Chapters 1-4")
            t2_file.write_text(turn2_res, encoding="utf-8")

        results["turn2_chapters_1_4"] = turn2_res

        # ----------------------------------------------------
        # TURN 3: Chapters 5 to 7 (~9,000 words)
        # ----------------------------------------------------
        t3_file = output_dir / "turn3_chapters_5_7.md"
        if t3_file.exists() and len(t3_file.read_text(encoding="utf-8")) > 500:
            logger.info("Found existing Turn 3 Chapters. Reusing...")
            turn3_res = t3_file.read_text(encoding="utf-8")
        else:
            t3_prompt = """Rất xuất sắc! Mạch truyện đang rất cuốn hút và giàu cảm xúc. Bây giờ hãy viết tiếp TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 3 CHƯƠNG TIẾP THEO (Chương 5, Chương 6, Chương 7) với tổng dung lượng khoảng 8.000 - 10.000 từ.

TRỌNG TÂM CỦA GIAI ĐOẠN NÀY (HỒI 3 - BIẾN CỐ & ĐIỀU TRA TRONG BÓNG TỐI):
- Chương 5: Biến cố tai nạn xảy ra / Nhân vật chính giả mù (hoặc giả bệnh). Đêm đầu tiên về nhà, nghe lén toàn bộ cuộc trò chuyện trơ trẽn giữa chồng/vợ và nhân tình ngoài ban công về kế hoạch tẩu tán tài sản tiền tỷ.
- Chương 6: Thu thập chứng cứ trong bóng tối. Sự phối hợp bí mật với đồng đội, luật sư, trích xuất camera, sao kê ngân hàng, khôi phục dữ liệu tin nhắn bị xóa.
- Chương 7: Giọt nước tràn ly. Cảnh kẻ phản bội và mẹ chồng lộ rõ bộ mặt tàn nhẫn, ép ký giấy tờ sang nhượng tài sản ngay trước mặt nhân tình. Sự kìm nén đỉnh điểm của nhân vật chính.

QUY TẮC:
- Tiếp tục duy trì ngôi kể "Cháu" [SPEAKER:nhan_vat_chinh] và các thẻ [SPEAKER:me_chong], [SPEAKER:tieu_tam] khi có đối thoại.
- Khắc họa chân thực sự đau đớn đến tột cùng chuyển hóa thành sự bình tĩnh, quyết đoán.
- Viết chi tiết, dài và đầy đặn, không tóm tắt."""
            turn3_res = await self.send_prompt_and_wait(t3_prompt, "Turn 3: Chapters 5-7")
            t3_file.write_text(turn3_res, encoding="utf-8")

        results["turn3_chapters_5_7"] = turn3_res

        # ----------------------------------------------------
        # TURN 4: Chapters 8 to 10 (~10,000 words - Climax & Outro)
        # ----------------------------------------------------
        t4_file = output_dir / "turn4_chapters_8_10.md"
        if t4_file.exists() and len(t4_file.read_text(encoding="utf-8")) > 500:
            logger.info("Found existing Turn 4 Chapters. Reusing...")
            turn4_res = t4_file.read_text(encoding="utf-8")
        else:
            t4_prompt = """Rất tuyệt vời! Bây giờ là phần quan trọng nhất: Hãy viết TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 3 CHƯƠNG CUỐI CÙNG (Chương 8, Chương 9, Chương 10) với tổng dung lượng khoảng 8.000 - 10.000 từ để hoàn tất toàn bộ câu chuyện 30.000 từ.

TRỌNG TÂM CỦA GIAI ĐOẠN NÀY (HỒI 4 & HỒI 5 - LẬT KÈO, CÔNG LÝ & HẬU VẬN):
- Chương 8: Khoảnh khắc lật kèo kinh điển. Nhân vật chính dứt khoát bước ra trong bộ sắc phục Sĩ quan Công an/Quân đội hoặc mang hồ sơ pháp lý khẳng định quyền sở hữu. Lực lượng chức năng ập vào bắt quả tang hành vi lừa đảo/làm giả giấy tờ. Sự sụp đổ và "chết lặng" hoàn toàn của kẻ ác.
- Chương 9: Cái giá phải trả của sự bất nghĩa. Kẻ vong ân nhận bản án nghiêm minh của pháp luật, gia đình chồng tan nát, sự hối hận muộn màng trong trại giam.
- Chương 10: Bình yên trở về và Bài học nhân sinh:
  * Nhân vật chính dẫn con nhỏ / cha mẹ già đi ăn bát phở nóng bên đường, tìm lại sự thanh thản trong tâm hồn.
  * Nhân vật đúc kết đạo lý cuộc đời: "Giá trị của một con người không nằm ở sự cam chịu, mà là dám đứng lên vì danh dự và sự thật...".
  * [SPEAKER:bac_sam] Bác Sâm quay lại với lời chào kết ấm áp, đúc kết bài học nhân quả cho người nghe, kêu gọi like, chia sẻ và đăng ký kênh Sâm Kể Chuyện.

QUY TẮC:
- Viết trọn vẹn, xúc động, giàu tính nhân văn và công lý. Đảm bảo dung lượng đầy đặn không rút gọn."""
            turn4_res = await self.send_prompt_and_wait(t4_prompt, "Turn 4: Chapters 8-10")
            t4_file.write_text(turn4_res, encoding="utf-8")

        results["turn4_chapters_8_10"] = turn4_res

        # Combine Full Script
        full_script = f"# KỊCH BẢN HOÀN CHỈNH: {topic_seed.get('title', 'Sâm Kể Chuyện')}\n\n"
        full_script += f"## PHẦN 1: HỒI 1 & HỒI 2 (CHƯƠNG 1 - 4)\n\n{turn2_res}\n\n"
        full_script += f"## PHẦN 2: HỒI 3 (CHƯƠNG 5 - 7)\n\n{turn3_res}\n\n"
        full_script += f"## PHẦN 3: HỒI 4 & HỒI 5 (CHƯƠNG 8 - 10)\n\n{turn4_res}\n"
        (output_dir / "full_story_script.md").write_text(full_script, encoding="utf-8")
        results["full_script"] = full_script

        # ----------------------------------------------------
        # TURN 5: SEO Metadata & Thumbnail Prompt
        # ----------------------------------------------------
        t5_file = output_dir / "turn5_metadata_seo.md"
        if t5_file.exists() and len(t5_file.read_text(encoding="utf-8")) > 500:
            logger.info("Found existing Turn 5 Metadata. Reusing...")
            turn5_res = t5_file.read_text(encoding="utf-8")
        else:
            t5_prompt = """Hãy tổng hợp và tạo TRỌN BỘ METADATA SEO YOUTUBE HOÀN CHỈNH cho video kịch bản trên:

CẤU TRÚC BẮT BUỘC:
1. TIÊU ĐỀ CHÍNH & 5 TIÊU ĐỀ BIẾN THỂ A/B TEST (Chuẩn giật gân, có chấm lách kiểm duyệt từ khóa như: B.ắt, T.ội Á.c, C.hết L.ặng, N.hân T.ình...).
2. MÔ TẢ VIDEO YOUTUBE (Description 6 phần chuẩn SEO):
   - Phần 1: Hook mở đầu 3 dòng tóm tắt kịch tính khơi gợi tò mò.
   - Phần 2: Giới thiệu câu chuyện sâu sắc.
   - Phần 3: Mục lục Chapters đầy đủ 10 chương kèm mốc thời gian.
   - Phần 4: Kêu gọi hành động (CTA: Like, Share, Đăng ký kênh).
   - Phần 5: Đoạn MIỄN TRỪ TRÁCH NHIỆM (Khẳng định truyện hư cấu, nhân vật tưởng tượng, giọng đọc AI để tuân thủ 100% chính sách YouTube).
   - Phần 6: 10 Hashtags chuẩn (#samkechuyen #tamsucungvansam #truyenaudio...).
3. DANH SÁCH 20 TAGS SEO YOUTUBE (Dạng danh sách phân cách dấu phẩy để copy dán vào ô Tags).
4. PROMPT TẠO ẢNH THUMBNAIL (Bằng tiếng Anh cho Midjourney/Flux mô tả chi tiết nhân vật chính mặc sắc phục hoặc gương mặt phụ nữ khắc khổ giàu cảm xúc, nền tương phản cao)."""
            turn5_res = await self.send_prompt_and_wait(t5_prompt, "Turn 5: SEO Metadata")
            t5_file.write_text(turn5_res, encoding="utf-8")

        results["turn5_metadata"] = turn5_res

        total_words = len(full_script.split())
        logger.info(f"=== FULL PIPELINE COMPLETED! ===")
        logger.info(f"Total script words: {total_words:,} words (~{total_words/135/60:.1f} hours audio)")
        logger.info(f"Saved artifacts to: {output_dir}")

        return results

async def main():
    parser = argparse.ArgumentParser(description="ChatGPT Vietnamese Story Pipeline")
    parser.add_argument("--story-id", type=str, help="Story ID to process")
    parser.add_argument("--test-topic", action="store_true", help="Run full 5-turn pipeline with test topic")
    args = parser.parse_args()

    topic = {}
    out_dir = REPO_ROOT / "web_vn" / "output" / "story_test_01"

    if args.story_id:
        out_dir = REPO_ROOT / "web_vn" / "output" / f"story_{args.story_id}"
        seed_file = out_dir / "topic_seed.json"
        if seed_file.exists():
            topic = json.loads(seed_file.read_text(encoding="utf-8"))
        else:
            logger.error(f"Topic seed file not found: {seed_file}")
            sys.exit(1)
    else:
        topic = {
            "title": "Thiếu Tá Điều Tra Giả Mù Sau T.ai N.ạn – Chồng và Tiểu Tam C.hết L.ặng Khi Thấy 20 Cảnh Sát Gọi Vợ Là Sếp | Sâm Kể Chuyện",
            "archetype": "Thiếu tá Công an / Cảnh sát điều tra tỉnh",
            "sacrifice": "Bán toàn bộ của hồi môn và vàng cưới của mẹ đẻ để lo vốn cho chồng lập nghiệp",
            "oppression": "Chồng rước Tiểu tam có bầu về nhà, mẹ chồng ép vợ ra đi tay trắng trong đêm mưa",
            "plot_secret": "Căn nhà 12 tỷ thực chất đứng tên riêng do bố mẹ đẻ mua từ trước ngày cưới",
            "retribution": "Cảnh sát ập vào phòng công chứng bắt giữ Tiểu tam và Chồng vì tội lừa đảo 15 tỷ",
            "moral": "Giá trị của người phụ nữ không nằm ở sự cam chịu, mà là dũng cảm sống vì sự thật và phẩm giá"
        }

    pipeline = ChatGPTStoryPipeline(headless=False)
    try:
        await pipeline.start()
        await pipeline.execute_full_story_pipeline(topic, out_dir)
    finally:
        await pipeline.stop()

if __name__ == '__main__':
    asyncio.run(main())
