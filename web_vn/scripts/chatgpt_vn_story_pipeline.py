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
SCRIPTS_DIR = REPO_ROOT / "web_vn" / "scripts"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from script_audio_parser import heal_speaker_tags
from auto_yt.paths import gpt_profile_dir
from playwright.async_api import async_playwright, Page, BrowserContext


CHATGPT_URL = "https://chatgpt.com/"
PROMPT_INPUT_SELECTOR = "#prompt-textarea, div[contenteditable='true'], div.ProseMirror, p[data-placeholder]"
STOP_SELECTOR = 'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label*="Stop"], button[aria-label*="stop"], button:has(svg.animate-spin)'
SEND_SELECTORS = (
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'button[aria-label="Send prompt"]',
)
NEW_CHAT_SELECTOR = '[data-testid="create-new-chat-button"], a[href="/"], button:has-text("New chat")'
CONTINUE_SELECTOR = 'button:has-text("Continue generating"), button:has-text("Tiếp tục"), button[data-testid*="continue"]'

# Threshold: if more than this ratio of [SPEAKER] tags lack role_id → trigger correction.
TAG_COMPLIANCE_THRESHOLD = 0.15
TAG_MAX_CORRECTION_RETRIES = 2


def validate_speaker_tags(text: str) -> dict:
    """
    Counts [SPEAKER:role_id] tag compliance in a generated script turn.
    Returns: { total, with_id, empty, empty_ratio, has_no_tags }

    Root cause guard: ChatGPT frequently ignores [SPEAKER:role_id] rules and outputs
    bare [SPEAKER] tags, causing the parser to misattribute 92%+ chunks to nhan_vat_chinh.
    This validator catches that pattern immediately after each turn is received.
    """
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


def build_correction_prompt(
    stats: dict,
    valid_roles: List[str],
    turn_label: str,
    sample_bad_lines: Optional[List[str]] = None,
) -> str:
    """
    Builds a targeted correction prompt when tag compliance fails.
    Sent as follow-up in the same ChatGPT conversation so context is preserved.
    Provides concrete before/after examples from actual output to guide the LLM.
    """
    roles_str = "\n".join(f"   - [SPEAKER:{r}]" for r in valid_roles)

    sample_block = ""
    if sample_bad_lines:
        sample_block = "\nVí dụ CÁC DÒNG SAI FORMAT trong bài vừa rồi và CÁCH SỬA:\n"
        for line in sample_bad_lines[:3]:
            fixed = re.sub(r'\[SPEAKER(?::\s*)?\]', f'[SPEAKER:{valid_roles[0]}]', line)
            sample_block += f"  ✗ SAI : {line[:80]}\n  ✓ ĐÚNG: {fixed[:80]}\n"

    return (
        f"⚠️ PHÁT HIỆN LỖI FORMAT NGHIÊM TRỌNG trong phần vừa viết ({turn_label}):\n"
        f"- Tổng số tag [SPEAKER] tìm thấy: {stats['total']}\n"
        f"- Số tag THIẾU role_id (chỉ có [SPEAKER] trơ): {stats['empty']} tag ({stats['empty_ratio']:.0%})\n"
        f"{sample_block}\n"
        f"QUY TẮC BẮT BUỘC: Mỗi tag speaker PHẢI có hậu tố role_id. "
        f"KHÔNG BAO GIỜ viết [SPEAKER] mà không có role.\n\n"
        f"DANH SÁCH ROLE HỢP LỆ DUY NHẤT:\n{roles_str}\n\n"
        f"Hãy viết lại TOÀN BỘ phần {turn_label} với đúng format [SPEAKER:role_id] cho TẤT CẢ các đoạn. "
        f"Không thêm lời giải thích — chỉ xuất thẳng nội dung đã sửa."
    )



GET_ASSISTANT_TEXT_BY_INDEX_SCRIPT = """
(index) => {
  const msgs = document.querySelectorAll('[data-markdown-text-style="assistant-message"], [data-message-author-role="assistant"]');
  if (!msgs || msgs.length === 0 || index >= msgs.length) return '';
  const node = msgs[index];
  const clone = node.cloneNode(true);
  for (const list of clone.querySelectorAll("ol, ul")) {
    const ordered = list.tagName === "OL";
    const start = ordered ? Number(list.getAttribute("start") || "1") : 1;
    const items = Array.from(list.children).filter((child) => child.tagName === "LI");
    items.forEach((item, i) => {
      const marker = ordered ? `${start + i}. ` : "- ";
      const firstParagraph = Array.from(item.children).find((child) => child.tagName === "P");
      const target = firstParagraph || item;
      target.insertBefore(document.createTextNode(marker), target.firstChild);
    });
  }
  return clone.innerText || clone.textContent || "";
}
"""

GET_LAST_ASSISTANT_TEXT_SCRIPT = GET_ASSISTANT_TEXT_BY_INDEX_SCRIPT

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
            await self.page.goto(CHATGPT_URL, wait_until="domcontentloaded", timeout=60000)
            await asyncio.sleep(2)
            new_chat_btn = self.page.locator(NEW_CHAT_SELECTOR).first
            if await new_chat_btn.is_visible(timeout=3000):
                await new_chat_btn.click()
                await asyncio.sleep(2)
            logger.info(f"Started fresh ChatGPT conversation at: {self.page.url}")
        except Exception as e:
            logger.warning(f"New chat notice: {e}")

    async def send_prompt_and_wait(self, prompt_text: str, turn_name: str, max_wait_sec: int = 420) -> str:
        logger.info(f"--- Sending Prompt [{turn_name}] ({len(prompt_text)} chars) ---")
        init_cnt = await self.page.evaluate(
            "() => document.querySelectorAll('[data-markdown-text-style=\"assistant-message\"], [data-message-author-role=\"assistant\"]').length"
        )
        target_idx = init_cnt

        textarea = self.page.locator(PROMPT_INPUT_SELECTOR).first
        await textarea.wait_for(state="visible", timeout=30000)
        await textarea.click()
        await asyncio.sleep(0.5)

        # Type text via browser keyboard events to guarantee ProseMirror & React state synchronization
        await self.page.keyboard.insert_text(prompt_text)
        await asyncio.sleep(0.5)

        send_btn = self.page.locator('button[aria-label="Send"], button[data-testid="send-button"], button[aria-label*="Send" i]').first
        if await send_btn.is_visible() and await send_btn.is_enabled():
            await send_btn.click()
        else:
            await self.page.keyboard.press("Enter")

        logger.info(f"Prompt sent. Waiting for generation to complete (target_msg_idx={target_idx}, max {max_wait_sec}s)...")

        stable_count = 0
        last_text_len = 0
        for sec in range(0, max_wait_sec, 3):
            await asyncio.sleep(3)
            
            try:
                stop_btn = self.page.locator(STOP_SELECTOR).first
                is_generating = await stop_btn.is_visible(timeout=300)
            except Exception:
                is_generating = False

            # Check if there is a "Continue generating" button
            try:
                continue_btn = self.page.locator(CONTINUE_SELECTOR).first
                if await continue_btn.is_visible(timeout=300):
                    logger.info(f"[{turn_name}] 'Continue generating' button detected. Resuming stream...")
                    await continue_btn.click()
                    await asyncio.sleep(2)
                    stable_count = 0
                    continue
            except Exception:
                pass

            cur_cnt = await self.page.evaluate(
                "() => document.querySelectorAll('[data-markdown-text-style=\"assistant-message\"], [data-message-author-role=\"assistant\"]').length"
            )
            if cur_cnt <= target_idx:
                if sec in (6, 12, 18):
                    logger.info(f"[{turn_name}] Retrying Send trigger (sec={sec})...")
                    if await send_btn.is_visible() and await send_btn.is_enabled():
                        await send_btn.click()
                    else:
                        await self.page.keyboard.press("Enter")
                continue

            try:
                current_text = await self.page.evaluate(GET_ASSISTANT_TEXT_BY_INDEX_SCRIPT, target_idx)
            except Exception as e:
                logger.debug(f"Evaluation retry: {e}")
                continue

            current_len = len(current_text)

            if not is_generating and cur_cnt > target_idx and current_len > 100:
                if current_len == last_text_len:
                    stable_count += 1
                    if stable_count >= 2:
                        logger.info(f"[{turn_name}] Generation complete! Total length: {current_len:,} chars.")
                        return current_text
                else:
                    stable_count = 0
            
            last_text_len = current_len
            if sec % 15 == 0:
                logger.info(f"[{turn_name}] Streaming in progress... ({current_len:,} chars received)")

        return await self.page.evaluate(GET_ASSISTANT_TEXT_BY_INDEX_SCRIPT, target_idx)

    async def _send_with_tag_validation(
        self,
        prompt_text: str,
        turn_name: str,
        valid_roles: List[str],
        max_wait_sec: int = 420,
    ) -> str:
        """
        Sends prompt to ChatGPT and applies deterministic Python auto-healer (heal_speaker_tags)
        to resolve all speaker tags safely without risking LLM truncation.
        """
        result = await self.send_prompt_and_wait(prompt_text, turn_name, max_wait_sec)

        stats = validate_speaker_tags(result)
        logger.info(
            f"[{turn_name}] Raw tag compliance: {stats['with_id']}/{stats['total']} have role_id "
            f"(empty_ratio={stats['empty_ratio']:.0%})"
        )

        if stats["empty"] > 0:
            logger.info(f"[{turn_name}] Auto-healer: patching {stats['empty']} bare tags in script...")
            healed_text = heal_speaker_tags(result, default_role="nhan_vat_chinh")
            healed_stats = validate_speaker_tags(healed_text)
            logger.info(
                f"[{turn_name}] Auto-healer result: {stats['empty']} bare -> {healed_stats['empty']} bare "
                f"({stats['empty_ratio']:.0%} -> {healed_stats['empty_ratio']:.0%})"
            )
            result = healed_text

        return result


    async def _ensure_context_loaded(self, turn1_res: str) -> None:
        """
        Opens a new ChatGPT chat and primes it with the blueprint so every
        subsequent turn has full context. Called once before the first turn
        that actually needs ChatGPT in a given session (whether fresh or resume).
        """
        logger.info("Priming new ChatGPT session with Master Blueprint...")
        await self.new_chat()
        prime_prompt = (
            "Dưới đây là MASTER BLUEPRINT VÀ DÀN Ý 10 CHƯƠNG ĐÃ ĐƯỢC PHÊ DUYỆT "
            "cho bộ truyện audio thời lượng 1h00 – 1h30 (khoảng 11.000 – 12.500 từ) "
            "phong cách \"Sâm Kể Chuyện\":\n\n"
            + turn1_res
            + "\n\nHãy ghi nhớ toàn bộ thông tin nhân vật, 5 hồi kịch bản và 10 chương này. "
            "Hãy trả lời ngắn gọn: 'ĐÃ NẮM RÕ MASTER BLUEPRINT' để chúng ta bắt đầu viết chi tiết từng chương."
        )
        await self.send_prompt_and_wait(prime_prompt, "Prime: Blueprint", max_wait_sec=90)
        logger.info("Session primed successfully.")

    async def _send_turn_with_word_guard(
        self,
        prompt_text: str,
        turn_name: str,
        valid_roles: List[str],
        min_words: int = 1500,
        max_wait_sec: int = 420,
    ) -> str:
        """
        Wraps _send_with_tag_validation() with a word-count guard.
        If the LLM returns suspiciously short output (< min_words), retries once.
        """
        result = await self._send_with_tag_validation(prompt_text, turn_name, valid_roles, max_wait_sec)
        word_count = len(result.split())
        if word_count < min_words:
            logger.warning(
                f"[{turn_name}] Short output detected ({word_count} words < {min_words} min). Retrying once..."
            )
            result = await self._send_with_tag_validation(prompt_text, turn_name, valid_roles, max_wait_sec)
            word_count = len(result.split())
            logger.info(f"[{turn_name}] Retry result: {word_count} words")
        else:
            logger.info(f"[{turn_name}] Word count OK: {word_count} words")
        return result

    async def execute_full_story_pipeline(self, topic_seed: Dict[str, Any], output_dir: Path) -> Dict[str, Any]:
        output_dir.mkdir(parents=True, exist_ok=True)
        results = {}

        # Extract dynamic cluster and character parameters
        default_pronoun = topic_seed.get('default_pronoun', 'Cháu')
        victim_role = topic_seed.get('victim_role', 'nhan_vat_chinh')
        victim_role_name = topic_seed.get('victim_role_name', topic_seed.get('archetype', 'Nhân vật chính / Nạn nhân'))
        antagonist_1_name = topic_seed.get('antagonist_1_name', 'Kẻ phản diện nữ (Mẹ Chồng / Tiểu Tam...)')
        antagonist_2_name = topic_seed.get('antagonist_2_name', 'Kẻ phản diện nam (Chồng / Con trai bất hiếu...)')
        justice_name = topic_seed.get('justice_name', 'Đại diện công lý / Đồng đội cũ')

        # Phase C: 4 canonical speaker roles only — reduces ChatGPT hallucination/confusion
        # ke_phan_dien_nu covers: me_chong, tieu_tam, me_gia (all female antagonists)
        # ke_phan_dien_nam covers: chong_boi_bac, can_bo, bo_chong, nguoi_chong (all male supporting)
        ROLE_NU_PHAN_DIEN = "ke_phan_dien_nu"
        ROLE_NAM_PHU = "ke_phan_dien_nam"

        # Valid role lists per turn — passed to tag validator
        ROLES_T2 = ["bac_sam", "nhan_vat_chinh", ROLE_NU_PHAN_DIEN, ROLE_NAM_PHU]
        ROLES_T3 = ["nhan_vat_chinh", ROLE_NU_PHAN_DIEN, ROLE_NAM_PHU]
        ROLES_T4 = ["nhan_vat_chinh", ROLE_NU_PHAN_DIEN, ROLE_NAM_PHU]
        ROLES_T5 = ["nhan_vat_chinh", "bac_sam"]


        # ----------------------------------------------------
        # TURN 1: Master Blueprint & 10-Chapter Outline (Target: 1h00 - 1h30)
        # ----------------------------------------------------
        # session_primed tracks whether _ensure_context_loaded() has been called
        # in this run. We call it lazily right before the first live ChatGPT turn.
        session_primed: bool = False

        t1_file = output_dir / "turn1_blueprint.md"
        if t1_file.exists() and len(t1_file.read_text(encoding="utf-8")) > 500:
            logger.info("Found existing Turn 1 Blueprint. Reusing (no ChatGPT call needed for T1).")
            turn1_res = t1_file.read_text(encoding="utf-8")
            # Do NOT prime here — we prime lazily before the first turn that needs ChatGPT.
        else:
            await self.new_chat()
            session_primed = True  # new_chat() already opened fresh session
            t1_prompt = f"""Bạn là chuyên gia biên kịch hàng đầu cho các chương trình truyện audio tâm sự, drama gia đình dài 1h00 đến 1h30 (60 – 90 phút, chuẩn 11.000 – 12.500 từ) trên YouTube (phong cách kênh "Sâm Kể Chuyện").

Dựa trên hạt mầm đề tài mang tính Viral Outlier cao sau:
- Thân phận nhân vật chính (Nạn nhân): {topic_seed.get('archetype', 'Nữ Trung úy Cảnh sát Điều tra')} (Đại từ xưng hô tự sự: "{default_pronoun}")
- Sự hy sinh ban đầu: {topic_seed.get('sacrifice', 'Bán toàn bộ tài sản, gom góp tiền của lo cho gia đình')}
- Hành vi áp bức / Bạc bẽo: {topic_seed.get('oppression', 'Bị ngược đãi, vu oan, đuổi khỏi nhà trong đêm mưa bão')}
- Bí mật lật kèo: {topic_seed.get('plot_secret', 'Tài sản đứng tên riêng hợp pháp, âm thầm thu thập chứng cứ')}
- Cán cân công lý / Trả giá: {topic_seed.get('retribution', 'Cơ quan chức năng và đồng đội vào cuộc bắt quả tang kẻ ác')}
- Bài học đạo lý: {topic_seed.get('moral', 'Gieo nhân nào gặt quả ấy, kẻ vong ân bội nghĩa ắt nhận quả đắng')}

HÃY LẬP BẢN MASTER BLUEPRINT VÀ DÀN Ý 10 CHƯƠNG CHI TIẾT (CHUẨN BỊ CHO BỘ TRUYỆN DÀI 11.000 – 12.500 TỪ):

Yêu cầu cấu trúc:
1. TIÊU ĐỀ CHÍNH & 3 TIÊU ĐỀ BIẾN THỂ (Giật gân, có chấm lách kiểm duyệt từ khóa như: Đ.ại T.á, B.ắt, T.ội Á.c, C.hết L.ặng, N.hân T.ình, S.ổ Đ.ỏ...).
2. HỒ SƠ NHÂN VẬT (Gán mã giọng đọc chuẩn — CHỈ 4 ROLES SAU, KHÔNG DÙNG ROLE KHÁC):
   - [SPEAKER:bac_sam] Bác Sâm - Người dẫn chuyện chiêm nghiệm, trầm ấm.
   - [SPEAKER:nhan_vat_chinh] {victim_role_name} - Tự sự ngôi thứ nhất "{default_pronoun}", kiên cường, giàu đức hy sinh.
   - [SPEAKER:ke_phan_dien_nu] {antagonist_1_name} - Kẻ phản diện nữ (Mẹ chồng / Tiểu tam / bất kỳ nhân vật nữ đối kháng nào).
   - [SPEAKER:ke_phan_dien_nam] {antagonist_2_name} / {justice_name} - Mọi nhân vật nam phụ (chồng, cán bộ, bố chồng, đồng đội...).
3. KHUNG 5 HỒI KỊCH BẢN (Tóm tắt cốt lõi từng hồi: Khởi đầu & Hy sinh -> Áp bức & Bạc bẽo -> Biến cố & Âm thầm điều tra -> Cao trào lật kèo & Công lý -> Nhân quả & Bình yên).
4. DÀN Ý 10 CHƯƠNG CHI TIẾT (Mỗi chương khoảng 1.100 - 1.300 từ): Tên chương, Mục tiêu kịch tính, Sự kiện chính xảy ra, Cao trào kết chương.

OUTPUT: Xuất nội dung Blueprint sạch sẽ, chuyên nghiệp."""
            turn1_res = await self.send_prompt_and_wait(t1_prompt, "Turn 1: Master Blueprint (1h-1h30 Plan)")
            t1_file.write_text(turn1_res, encoding="utf-8")

        results["turn1_blueprint"] = turn1_res

        # ----------------------------------------------------
        # TURN 2: Chapters 1 to 3 (~3,500 words)
        # ----------------------------------------------------
        t2_file = output_dir / "turn2_chapters_1_3.md"
        if t2_file.exists() and len(t2_file.read_text(encoding="utf-8")) > 500:
            logger.info("Found existing Turn 2 Chapters (1-3). Reusing...")
            turn2_res = t2_file.read_text(encoding="utf-8")
        else:
            if not session_primed:
                await self._ensure_context_loaded(turn1_res)
                session_primed = True
            t2_prompt = f"""Dựa trên Master Blueprint đã duyệt, bạn hãy viết TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 3 CHƯƠNG ĐẦU TIÊN (Chương 1, Chương 2, Chương 3) với tổng dung lượng khoảng 3.300 - 3.800 từ (~1.100 - 1.300 từ/chương).

QUY TẮC BẮT BUỘC VỀ ĐỊNH DẠNG & PHÂN VAI (BẮT BUỘC TUÂN THỦ 100%):
1. QUY CHUẨN XUỐNG DÒNG & TAG NHÂN VẬT:
   - MỖI ĐOẠN VĂN HOẶC CÂU THOẠI PHẢI BẮT ĐẦU TRÊN MỘT DÒNG RIÊNG VỚI ĐÚNG TAG CỤ THỂ.
   - TUYỆT ĐỐI KHÔNG xuất thẻ [SPEAKER] trơ trọi không có role_id! Vi phạm này sẽ bị phát hiện và yêu cầu viết lại.

2. CHỈ DÙNG ĐÚNG 4 ROLES NÀY (KHÔNG TỰ TẠO TAG LẠ):
   - [SPEAKER:bac_sam] : Lời mở đầu giới thiệu của Bác Sâm (đầu Chương 1 mà thôi)
   - [SPEAKER:nhan_vat_chinh] : Lời tự sự và đối thoại của nhân vật chính ({victim_role_name} - xưng "{default_pronoun}")
   - [SPEAKER:ke_phan_dien_nu] : Lời thoại của MỌI nhân vật nữ phản diện ({antagonist_1_name} và tương tự)
   - [SPEAKER:ke_phan_dien_nam] : Lời thoại của MỌI nhân vật nam phụ ({antagonist_2_name}, cán bộ, đồng đội...)

3. MẪU ĐỊNH DẠNG BẮT BUỘC (FEW-SHOT EXAMPLE):
   [SPEAKER:bac_sam] Kính chào quý vị và các bạn đang lắng nghe Sâm Kể Chuyện. Đêm nay, bác Sâm xin gửi đến quý vị một câu chuyện đầy xúc động...
   [SPEAKER:nhan_vat_chinh] Cháu tên là Minh Hà. Nếu phải chọn một đêm mà cả đời này cháu không thể quên, có lẽ đó là đêm mưa định mệnh ấy.
   [SPEAKER:nhan_vat_chinh] Bước vào phòng khách, tôi sững người khi thấy người phụ nữ lạ mặt đang ngồi gọt táo.
   [SPEAKER:ke_phan_dien_nu] Con ăn thêm miếng táo đi, đang có bầu thì phải chịu khó bồi dưỡng.
   [SPEAKER:ke_phan_dien_nu] Chị về rồi đấy à? Em xin lỗi vì đã đường đột đến đây.
   [SPEAKER:nhan_vat_chinh] Tôi siết chặt bàn tay, cố giữ cho giọng mình không run rẩy.

4. QUY TẮC VỀ LỜI DẪN CHƯƠNG (QUAN TRỌNG):
   - Lời chiêm nghiệm / tóm kết / chuyển cảnh đầu hoặc cuối mỗi chương → LUÔN dùng [SPEAKER:nhan_vat_chinh] (nhân vật chính tự sự).
   - [SPEAKER:bac_sam] CHỈ xuất hiện đúng 1 lần ở đầu Chương 1, KHÔNG xuất hiện ở Chương 2–9.
   - TUYỆT ĐỐI KHÔNG dùng [SPEAKER:ke_phan_dien_nu] hay [SPEAKER:ke_phan_dien_nam] cho lời chiêm nghiệm hay dẫn chuyện — đây không phải thoại của nhân vật phản diện.

5. TUYỆT ĐỐI KHÔNG DÙNG THẺ CẢM XÚC NHÂN TẠO như [thở dài], [cười], [khóc]... Chỉ dùng dấu câu tự nhiên (., ! ? …).

5. TIÊU ĐỀ CHƯƠNG & NỘI DUNG:
   - Ghi rõ tiêu đề theo Blueprint: CHƯƠNG 1: ..., CHƯƠNG 2: ..., CHƯƠNG 3: ...
   - Dung lượng: Viết cực kỳ chi tiết, chậm rãi, đầy đặn từng phân cảnh đời thực, nhiều chi tiết giác quan, không tóm tắt lướt qua."""
            turn2_res = await self._send_turn_with_word_guard(t2_prompt, "Turn 2: Chapters 1-3", ROLES_T2, min_words=1500)
            t2_file.write_text(turn2_res, encoding="utf-8")

        results["turn2_chapters_1_3"] = turn2_res


        # ----------------------------------------------------
        # TURN 3: Chapters 4 to 6 (~3,800 words)
        # ----------------------------------------------------
        t3_file = output_dir / "turn3_chapters_4_6.md"
        if t3_file.exists() and len(t3_file.read_text(encoding="utf-8")) > 500:
            logger.info("Found existing Turn 3 Chapters (4-6). Reusing...")
            turn3_res = t3_file.read_text(encoding="utf-8")
        else:
            if not session_primed:
                await self._ensure_context_loaded(turn1_res)
                session_primed = True
            t3_prompt = f"""Mạch truyện rất cuốn hút và cảm xúc! Bây giờ hãy viết tiếp TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 3 CHƯƠNG TIẾP THEO (Chương 4, Chương 5, Chương 6) bám sát Dàn ý Blueprint đã duyệt (HỒI 2 & HỒI 3 - ĐỈNH ĐIỂM ÁP BỨC, BI KỊCH & ÂM THẦM THU THẬP CHỨNG CỨ) với tổng dung lượng khoảng 3.500 - 4.000 từ (~1.200 - 1.350 từ/chương).

QUY TẮC BẮT BUỘC:
- MỖI ĐOẠN VĂN HOẶC CÂU THOẠI BẮT BUỘC BẮT ĐẦU TRÊN MỘT DÒNG MỚI VỚI ĐÚNG TAG:
  [SPEAKER:nhan_vat_chinh] cho lời kể tự sự của nhân vật chính (xưng "{default_pronoun}").
  [SPEAKER:ke_phan_dien_nu] cho mọi câu thoại của nhân vật nữ phản diện ({antagonist_1_name} và tương tự).
  [SPEAKER:ke_phan_dien_nam] cho mọi nhân vật nam phụ ({antagonist_2_name}, chồng, cán bộ...).
- TUYỆT ĐỐI KHÔNG xuất [SPEAKER] trơ trọi. Vi phạm sẽ bị phát hiện tự động và yêu cầu viết lại.
- TUYỆT ĐỐI KHÔNG DÙNG THẺ CẢM XÚC NHÂN TẠO như [thở dài], [khóc]...
- LỜI DẪN CHƯƠNG: Mọi lời chiêm nghiệm / tóm kết đầu-cuối chương → [SPEAKER:nhan_vat_chinh]. KHÔNG dùng [SPEAKER:ke_phan_dien_nu] cho lời dẫn.
- Viết chi tiết, sâu sắc, đẩy mâu thuẫn lên cao trào kịch tính."""
            turn3_res = await self._send_turn_with_word_guard(t3_prompt, "Turn 3: Chapters 4-6", ROLES_T3, min_words=1500)
            t3_file.write_text(turn3_res, encoding="utf-8")

        results["turn3_chapters_4_6"] = turn3_res

        # ----------------------------------------------------
        # TURN 4: Chapters 7 to 9 (~3,800 words - Climax)
        # ----------------------------------------------------
        t4_file = output_dir / "turn4_chapters_7_9.md"
        if t4_file.exists() and len(t4_file.read_text(encoding="utf-8")) > 500:
            logger.info("Found existing Turn 4 Chapters (7-9). Reusing...")
            turn4_res = t4_file.read_text(encoding="utf-8")
        else:
            if not session_primed:
                await self._ensure_context_loaded(turn1_res)
                session_primed = True
            t4_prompt = f"""Rất tuyệt vời! Bây giờ hãy viết TOÀN BỘ NỘI DUNG CHI TIẾT CỦA 3 CHƯƠNG CAO TRÀO (Chương 7, Chương 8, Chương 9) bám sát Dàn ý Blueprint (HỒI 4 - BẮT QUẢ TANG, LẬT KÈO KINH ĐIỂN & PHÁP LUẬT / CÔNG LÝ THỰC THI) với tổng dung lượng khoảng 3.500 - 4.000 từ (~1.200 - 1.350 từ/chương).

QUY TẮC BẮT BUỘC:
- MỖI ĐOẠN VĂN HOẶC CÂU THOẠI BẮT BUỘC BẮT ĐẦU TRÊN MỘT DÒNG MỚI VỚI ĐÚNG TAG CỤ THỂ:
  [SPEAKER:nhan_vat_chinh], [SPEAKER:ke_phan_dien_nu], [SPEAKER:ke_phan_dien_nam].
- [SPEAKER:ke_phan_dien_nam] dùng cho cả cán bộ pháp luật / đồng đội vào cứu nhân vật chính.
- TUYỆT ĐỐI KHÔNG xuất [SPEAKER] trơ trọi. Vi phạm sẽ bị phát hiện tự động và yêu cầu viết lại.
- TUYỆT ĐỐI KHÔNG DÙNG THẺ CẢM XÚC NHÂN TẠO như [thở dài], [khóc]...
- LỜI DẪN CHƯƠNG: Mọi lời chiêm nghiệm / tóm kết đầu-cuối chương → [SPEAKER:nhan_vat_chinh]. KHÔNG dùng [SPEAKER:ke_phan_dien_nu] cho lời dẫn.
- Khắc họa cảm xúc đối lập cực mạnh: Từ hả hê trơ trẽn sang bàng hoàng sụp đổ khi công lý được thực thi."""
            t4_prompt = t4_prompt.strip()
            turn4_res = await self._send_turn_with_word_guard(t4_prompt, "Turn 4: Chapters 7-9", ROLES_T4, min_words=1500)
            t4_file.write_text(turn4_res, encoding="utf-8")

        results["turn4_chapters_7_9"] = turn4_res

        # ----------------------------------------------------
        # TURN 5: Chapter 10 & Bác Sâm Outro (~1,500 words)
        # ----------------------------------------------------
        t5_file = output_dir / "turn5_chapter_10_outro.md"
        if t5_file.exists() and len(t5_file.read_text(encoding="utf-8")) > 500:
            logger.info("Found existing Turn 5 Chapter 10. Reusing...")
            turn5_res = t5_file.read_text(encoding="utf-8")
        else:
            if not session_primed:
                await self._ensure_context_loaded(turn1_res)
                session_primed = True
            t5_prompt = f"""Rất xuất sắc! Bây giờ hãy viết CHƯƠNG 10 VÀ LỜI KẾT BÁC SÂM (HỒI 5 - NHÂN QUẢ PHÂN MINH, BÌNH YÊN & BÀI HỌC CUỘC ĐỜI) với dung lượng khoảng 1.300 - 1.600 từ:

CẤU TRÚC:
1. CHƯƠNG 10: Theo dàn ý Blueprint
   - [SPEAKER:nhan_vat_chinh] Bản án nghiêm minh cho kẻ ác. Nhân vật chính tìm lại sự thanh thản, tự do và phẩm giá bên người thân yêu thực sự. Lời đúc kết sâu sắc về giá trị cuộc đời (xưng "{default_pronoun}").
2. LỜI CHÀO KẾT CỦA BÁC SÂM:
   - [SPEAKER:bac_sam] "Quý vị và các bạn thân mến, câu chuyện đêm nay khép lại với thật nhiều dư ba...". Phân tích đạo lý nhân quả, chúc quý khán thính giả an lành, kêu gọi bấm Đăng ký kênh Sâm Kể Chuyện.

QUY TẮC BẮT BUỘC:
- MỖI ĐOẠN VĂN BẮT ĐẦU TRÊN MỘT DÒNG MỚI VỚI ĐÚNG TAG [SPEAKER:nhan_vat_chinh] HOẶC [SPEAKER:bac_sam].
- TUYỆT ĐỐI KHÔNG xuất [SPEAKER] trơ trọi. Vi phạm sẽ bị phát hiện tự động.
- TUYỆT ĐỐI KHÔNG DÙNG THẺ CẢM XÚC NHÂN TẠO như [thở dài], [khóc]..."""
            turn5_res = await self._send_turn_with_word_guard(t5_prompt, "Turn 5: Chapter 10 & Outro", ROLES_T5, min_words=600)
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
            logger.info("Found existing Turn 6 Metadata. Reusing...")
            turn6_res = t6_file.read_text(encoding="utf-8")
        else:
            t6_prompt = """Hãy tổng hợp và tạo TRỌN BỘ METADATA SEO YOUTUBE HOÀN CHỈNH cho video kịch bản 1h30 trên:

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
            turn6_res = await self.send_prompt_and_wait(t6_prompt, "Turn 6: SEO Metadata")
            t6_file.write_text(turn6_res, encoding="utf-8")

        results["turn6_metadata"] = turn6_res

        total_words = len(full_script.split())
        logger.info(f"=== FULL PIPELINE COMPLETED! ===")
        logger.info(f"Total script words: {total_words:,} words (~{total_words/125/60:.1f} hours audio • 1h00-1h30 target)")
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
