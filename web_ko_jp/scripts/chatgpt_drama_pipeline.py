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
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from auto_yt.paths import gpt_profile_dir
from playwright.async_api import async_playwright, Page, BrowserContext

CHATGPT_URL = "https://chatgpt.com/"
PROMPT_INPUT_SELECTOR = "#prompt-textarea"
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


async def send_chatgpt_message(page: Page, message: str, timeout_seconds: int = 400) -> str:
    prompt_input = page.locator(PROMPT_INPUT_SELECTOR).first
    await prompt_input.wait_for(state="visible", timeout=30000)
    
    stop_btn = page.locator(STOP_SELECTOR).first
    wait_stop_deadline = asyncio.get_running_loop().time() + 30
    while await stop_btn.is_visible() and asyncio.get_running_loop().time() < wait_stop_deadline:
        await asyncio.sleep(1)

    previous_count = await page.locator(ASSISTANT_SELECTOR).count()
    previous_text = ""
    if previous_count > 0:
        previous_text = await page.locator(ASSISTANT_SELECTOR).last.evaluate(RENDERED_MESSAGE_TEXT_SCRIPT)
        previous_text = str(previous_text).strip()
    
    await set_composer_text(page, message)
    await asyncio.sleep(0.4)
    await submit_prompt(page)
    logger.info("Message sent. Waiting for generation to start...")
    
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    started = False
    while asyncio.get_running_loop().time() < deadline:
        curr_count = await page.locator(ASSISTANT_SELECTOR).count()
        stop_count = await page.locator(STOP_SELECTOR).count()
        if curr_count > previous_count or stop_count > 0:
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
            
        messages = page.locator(ASSISTANT_SELECTOR)
        msg_count = await messages.count()
        if msg_count > 0:
            curr_text = await messages.nth(msg_count - 1).evaluate(RENDERED_MESSAGE_TEXT_SCRIPT)
            curr_text = str(curr_text).strip()
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

        # TURN 2: Tiêu đề 【99％が知らない】
        logger.info("[TURN 2/5] Generating dramatic Japanese title...")
        prompt_turn2 = (
            f"viết lại tiêu đề sao cho GAY GẮT, KHẲNG ĐỊNH, THÔ RÁP, DRAMA. chuẩn SEO. "
            f"bắt đầu bằng 【99％が知らない】(phù hợp với thị trường Nhật Bản)\n\n{title}"
        )
        raw_title_response = await send_chatgpt_message(page, prompt_turn2, timeout_seconds=180)
        title_lines = [l.strip() for l in raw_title_response.splitlines() if l.strip()]
        title_jp = next((l for l in title_lines if "【99" in l or "99%" in l), title_lines[0] if title_lines else raw_title_response)
        title_jp = title_jp.strip('"`*')
        logger.info(f"[TURN 2 DONE] Title: {title_jp}")
        await asyncio.sleep(2)

        # TURN 3: Mô tả & 3 #tag
        logger.info("[TURN 3/5] Generating SEO video description & 3 tags...")
        prompt_turn3 = "viết mô tả ngắn gọn chuẩn SEO cho video và 3 #tag"
        description_jp = await send_chatgpt_message(page, prompt_turn3, timeout_seconds=180)
        logger.info(f"[TURN 3 DONE] Description length: {len(description_jp)} chars.")
        await asyncio.sleep(2)

        # TURN 4: Text trên Thumbnail
        logger.info("[TURN 4/5] Generating 3-line dramatic thumbnail text...")
        prompt_turn4 = (
            f"chốt\n{title_jp}\n"
            f"hãy đề xuất text trên thumb (3 dòng không quá dài) sao cho clickbait, gây gốc, GAY GẮT, KHẲNG ĐỊNH, THÔ RÁP, DRAMA."
        )
        raw_thumb_response = await send_chatgpt_message(page, prompt_turn4, timeout_seconds=180)
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

        # AUDIO TTS: Tùy chọn sinh audio lồng tiếng bằng GPT-SoVITS (giọng Matsushita drama seg_A)
        audio_url = None
        if synthesize_audio and script_jp:
            try:
                from tts_gpt_sovits import generate_japanese_narration
                logger.info("[AUDIO TTS] Synthesizing Japanese drama narration via GPT-SoVITS...")
                audio_file = generate_japanese_narration(text=script_jp)
                audio_url = f"/api/audio?file={Path(audio_file).name}"
                logger.info(f"[AUDIO TTS DONE] Audio file ready at: {audio_url}")
            except Exception as tts_err:
                logger.error(f"[AUDIO TTS ERROR] Audio synthesis failed: {tts_err}")
        
        return {
            "title": title,
            "url": url,
            "conversation_url": conversation_url,
            "title_jp": title_jp,
            "script_jp": script_jp,
            "description_jp": description_jp,
            "thumbnail_text": chosen_thumb_text,
            "thumbnail_options": thumb_options,
            "thumbnail_image_url": thumbnail_image_url,
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