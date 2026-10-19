# -*- coding: utf-8 -*-
"""
STAGE 7A: DRAMA SCENE IMAGE GENERATION PROVIDER ABSTRACTION
- Abstract Base Class ThumbnailImageProvider
- Implemented Providers:
  1. PlaywrightChatGPTImageProvider (with global asyncio.Lock() Mutex for PROFILE_GPT_1 concurrency protection)
  2. OpenAIImageProvider (Direct DALL-E 3 API)
  3. GeminiImageProvider (Imagen 3 / 9Router)
  4. MockCompositorProvider (Offline fallback drama canvas for testing)
- Generates clean 16:9 drama scene image (drama_scene_raw.png) without host or text
- Safety-Aware recovery with 1 retry on filter rejection
"""

import sys
import os
import json
import time
import base64
import asyncio
import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
import httpx
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance, ImageFont

REPO_ROOT = Path(r"D:\VibeCoding\auto_YT")
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from auto_yt.paths import gpt_profile_dir
from .stage6_prompt_builder import create_safe_reformulation

logger = logging.getLogger("thumbnail_pipeline.stage7")

# Global Mutex to prevent multiple tasks from typing into the same ChatGPT browser simultaneously
_PLAYWRIGHT_MUTEX = asyncio.Lock()


class ThumbnailImageProvider(ABC):
    """Abstract Base Class for Image Generation Providers."""

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        reference_images: Optional[List[Path]] = None,
        aspect_ratio: str = "16:9",
        output_path: Optional[Path] = None,
        expected_headline: Optional[str] = None,
    ) -> Path:
        """Generates an image from prompt and returns the output path."""
        pass


class PlaywrightChatGPTImageProvider(ThumbnailImageProvider):
    """
    Automates drama scene image generation via ChatGPT web UI with persistent PROFILE_GPT_1 profile.
    Protected by global Mutex lock to serialize parallel jobs.
    """

    def __init__(self, headless: bool = False, timeout_sec: int = 240):
        self.headless = headless
        self.timeout_sec = timeout_sec

    async def generate(
        self,
        prompt: str,
        reference_images: Optional[List[Path]] = None,
        aspect_ratio: str = "16:9",
        output_path: Optional[Path] = None,
        expected_headline: Optional[str] = None,
    ) -> Path:
        async with _PLAYWRIGHT_MUTEX:
            return await self._generate_internal(
                prompt=prompt,
                reference_images=reference_images,
                aspect_ratio=aspect_ratio,
                output_path=output_path,
                expected_headline=expected_headline,
            )

    async def _generate_internal(
        self,
        prompt: str,
        reference_images: Optional[List[Path]] = None,
        aspect_ratio: str = "16:9",
        output_path: Optional[Path] = None,
        expected_headline: Optional[str] = None,
    ) -> Path:
        from playwright.async_api import async_playwright

        target_path = output_path or (REPO_ROOT / "web_vn" / "output" / "drama_scene_raw.png")
        target_path.parent.mkdir(parents=True, exist_ok=True)

        profile_dir = gpt_profile_dir()
        logger.info(f"[Playwright] Launching Chromium with profile: {profile_dir}")

        has_ref = False
        valid_refs = []
        if reference_images:
            for r in reference_images:
                if r and os.path.exists(str(r)):
                    has_ref = True
                    valid_refs.append(str(r))

        if has_ref:
            formatted_prompt = (
                f"Dựa vào hình ảnh được đính kèm, hãy tạo một bức ảnh 16:9 chất lượng cao theo mô tả sau:\n\n"
                f"{prompt}"
            )
        else:
            formatted_prompt = (
                f"Hãy tạo một bức ảnh bối cảnh phim truyền hình 16:9 chất lượng cao không có chữ và không có người dẫn chuyện theo mô tả sau:\n\n"
                f"{prompt}"
            )

        IMAGE_EXTRACT_JS = """
        () => {
          const imgs = Array.from(document.querySelectorAll('main img, article img, [data-message-author-role="assistant"] img, div[class*="image"] img, img[alt]'));
          for (let i = imgs.length - 1; i >= 0; i--) {
            const img = imgs[i];
            const src = img.src || '';
            const alt = (img.alt || '').toLowerCase();
            if (src.includes('avatar') || src.includes('emoji') || src.includes('icon') || src.startsWith('data:image/svg')) continue;
            if (alt.includes('generated') || alt.includes('dall') || alt.includes('image') || alt.includes('bức ảnh') || alt.includes('thumbnail')) return src;
            if (src.startsWith('blob:https://chatgpt.com/') && (img.naturalWidth > 150 || img.width > 150 || img.clientWidth > 150)) return src;
            if ((src.includes('oaidalleapiprodscus') || src.includes('files.oaiusercontent.com') || src.includes('backend-api/estuary')) && (img.naturalWidth > 150 || img.width > 150)) return src;
            if ((img.naturalWidth > 250 && img.naturalHeight > 180) || (img.width > 250 && img.height > 180) || (img.clientWidth > 250 && img.clientHeight > 180)) return src;
          }
          return null;
        }
        """

        FETCH_IMAGE_BASE64_JS = """
        async (imgSrc) => {
          try {
            const res = await fetch(imgSrc);
            const blob = await res.blob();
            const dataUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(blob);
            });
            if (dataUrl && dataUrl.startsWith('data:image')) return dataUrl;
          } catch (err) {}
          try {
            const img = document.querySelector(`img[src="${imgSrc}"]`) || document.querySelector('img[alt*="Generated image" i]') || document.querySelector('img[alt*="image" i]');
            if (img) {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth || img.width || 1280;
              canvas.height = img.naturalHeight || img.height || 720;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              return canvas.toDataURL('image/png');
            }
          } catch (e2) {}
          return null;
        }
        """

        playwright = await async_playwright().start()
        context = None
        try:
            context = await playwright.chromium.launch_persistent_context(
                user_data_dir=str(profile_dir),
                headless=self.headless,
                channel="chrome",
                viewport={"width": 1280, "height": 900},
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-dev-shm-usage"
                ]
            )
            page = context.pages[0] if context.pages else await context.new_page()
            logger.info("[Playwright] Navigating to https://chatgpt.com/...")
            await page.goto("https://chatgpt.com/", wait_until="domcontentloaded", timeout=60000)
            await asyncio.sleep(3)

            # Click New Chat
            try:
                new_chat_btn = page.locator('[data-testid="create-new-chat-button"], a[href="/"], button:has-text("New chat")').first
                if await new_chat_btn.is_visible(timeout=3000):
                    await new_chat_btn.click()
                    await asyncio.sleep(2)
            except Exception:
                pass

            # Attach Reference Image if provided
            if valid_refs:
                for ref_str in valid_refs:
                    logger.info(f"[Playwright] Uploading Reference Image: {ref_str}")
                    try:
                        file_input = page.locator('input[type="file"]').first
                        await file_input.set_input_files(ref_str)
                        await asyncio.sleep(3.5)
                    except Exception as ue:
                        logger.warning(f"[Playwright] Attachment upload note: {ue}")

            # Input prompt
            textarea = page.locator("#prompt-textarea, div[contenteditable='true'], div.ProseMirror, p[data-placeholder]").first
            await textarea.wait_for(state="visible", timeout=30000)
            await textarea.click()
            await asyncio.sleep(0.5)

            logger.info(f"[Playwright] Inserting drama scene prompt ({len(formatted_prompt)} chars)...")
            await page.keyboard.insert_text(formatted_prompt)
            await asyncio.sleep(0.8)

            send_btn = page.locator('button[aria-label="Send"], button[type="submit"], button[data-testid="send-button"]').first
            if await send_btn.is_visible() and await send_btn.is_enabled():
                await send_btn.click()
            else:
                await page.keyboard.press("Enter")

            logger.info(f"[Playwright] Waiting for drama scene render (up to {self.timeout_sec}s)...")
            image_src = None
            start_time = time.time()
            stop_selector = 'button[aria-label="Stop"], button[data-testid="stop-button"], button:has(svg.animate-spin)'
            followup_sent = False

            while time.time() - start_time < self.timeout_sec:
                await asyncio.sleep(3)
                is_generating = False
                try:
                    stop_btn = page.locator(stop_selector).first
                    is_generating = await stop_btn.is_visible(timeout=300)
                except Exception:
                    pass

                # Check if Guardrail error occurred -> trigger 1 safe retry
                has_guardrail = await page.evaluate("() => document.body.innerText.includes('guardrails around violence') || document.body.innerText.includes('content policy') || document.body.innerText.includes('may violate')")
                if has_guardrail and not followup_sent:
                    followup_sent = True
                    logger.warning("[Playwright] DALL-E Guardrail triggered. Reformulating with Safety-Aware Adapter...")
                    safe_soft_prompt = create_safe_reformulation(prompt, headline=expected_headline or "")
                    try:
                        safe_textarea = page.locator("#prompt-textarea, div[contenteditable='true']").first
                        if await safe_textarea.is_visible(timeout=5000):
                            await safe_textarea.click()
                            await page.keyboard.insert_text(f"Vẽ lại bức ảnh bối cảnh phim 16:9 theo mô tả an toàn này, không có chữ: {safe_soft_prompt}")
                            await asyncio.sleep(0.5)
                            s_btn = page.locator('button[aria-label="Send"], button[type="submit"]').first
                            if await s_btn.is_visible() and await s_btn.is_enabled():
                                await s_btn.click()
                            else:
                                await page.keyboard.press("Enter")
                    except Exception as fe:
                        logger.warning(f"Failed to submit safe reformulation: {fe}")

                src = await page.evaluate(IMAGE_EXTRACT_JS)
                if src:
                    logger.info(f"[Playwright] Detected generated drama image: {src[:70]}...")
                    image_src = src
                    if not is_generating:
                        await asyncio.sleep(2)
                        break

            if not image_src:
                raise TimeoutError("No image generated by ChatGPT within timeout.")

            base64_data = await page.evaluate(FETCH_IMAGE_BASE64_JS, image_src)
            if base64_data and "base64," in base64_data:
                b64_str = base64_data.split("base64,")[1]
                img_bytes = base64.b64decode(b64_str)
                target_path.write_bytes(img_bytes)
                logger.info(f"[Playwright] Saved drama scene image: {target_path} ({len(img_bytes):,} bytes)")
                return target_path
            else:
                img_el = page.locator(f'img[src="{image_src}"]').first
                if await img_el.is_visible():
                    await img_el.screenshot(path=str(target_path))
                    logger.info(f"[Playwright] Saved screenshot fallback: {target_path}")
                    return target_path

            raise RuntimeError("Failed to extract image binary from browser session.")

        finally:
            if context:
                await context.close()
            if playwright:
                await playwright.stop()


class OpenAIImageProvider(ThumbnailImageProvider):
    """Direct OpenAI API (DALL-E 3) Provider."""

    def __init__(self, api_key: Optional[str] = None, model: str = "dall-e-3"):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.model = model

    async def generate(
        self,
        prompt: str,
        reference_images: Optional[List[Path]] = None,
        aspect_ratio: str = "16:9",
        output_path: Optional[Path] = None,
        expected_headline: Optional[str] = None,
    ) -> Path:
        target_path = output_path or (REPO_ROOT / "web_vn" / "output" / "drama_scene_raw.png")
        target_path.parent.mkdir(parents=True, exist_ok=True)

        if not self.api_key:
            raise ValueError("OPENAI_API_KEY is not set.")

        size = "1792x1024" if aspect_ratio == "16:9" else "1024x1024"
        clean_prompt = prompt[:3900]

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/images/generations",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "prompt": clean_prompt,
                    "n": 1,
                    "size": size,
                    "response_format": "b64_json"
                }
            )
            resp.raise_for_status()
            data = resp.json()
            b64_str = data["data"][0]["b64_json"]
            img_bytes = base64.b64decode(b64_str)
            target_path.write_bytes(img_bytes)
            return target_path


class GeminiImageProvider(ThumbnailImageProvider):
    """Google Gemini Imagen 3 Provider via 9Router gateway."""

    def __init__(self, base_url: str = "http://localhost:20128/v1", model: str = "imagen-3.0-generate-002"):
        self.base_url = base_url.rstrip('/')
        self.model = model

    async def generate(
        self,
        prompt: str,
        reference_images: Optional[List[Path]] = None,
        aspect_ratio: str = "16:9",
        output_path: Optional[Path] = None,
        expected_headline: Optional[str] = None,
    ) -> Path:
        target_path = output_path or (REPO_ROOT / "web_vn" / "output" / "drama_scene_raw.png")
        target_path.parent.mkdir(parents=True, exist_ok=True)

        clean_prompt = prompt[:2000]
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(
                f"{self.base_url}/images/generations",
                headers={"Authorization": "Bearer sk-a14e750bfb202e50-w5y7yc-17ca4e59"},
                json={
                    "model": self.model,
                    "prompt": clean_prompt,
                    "aspect_ratio": "16:9",
                    "response_format": "b64_json"
                }
            )
            resp.raise_for_status()
            data = resp.json()
            b64_str = data["data"][0]["b64_json"]
            img_bytes = base64.b64decode(b64_str)
            target_path.write_bytes(img_bytes)
            return target_path


class MockCompositorProvider(ThumbnailImageProvider):
    """Fallback canvas provider for offline / mock testing with simulated drama scene."""

    async def generate(
        self,
        prompt: str,
        reference_images: Optional[List[Path]] = None,
        aspect_ratio: str = "16:9",
        output_path: Optional[Path] = None,
        expected_headline: Optional[str] = None,
    ) -> Path:
        target_path = output_path or (REPO_ROOT / "web_vn" / "output" / "drama_scene_raw.png")
        target_path.parent.mkdir(parents=True, exist_ok=True)

        w, h = 1280, 720
        img = Image.new("RGB", (w, h), (18, 22, 36))
        draw = ImageDraw.Draw(img)

        # Draw deep cinematic background
        for y in range(h):
            ratio = y / float(h)
            r = int(18 * (1 - ratio) + 8 * ratio)
            g = int(25 * (1 - ratio) + 12 * ratio)
            b = int(55 * (1 - ratio) + 22 * ratio)
            draw.line([(0, y), (w, y)], fill=(r, g, b))

        # Draw simulated drama characters silhouette / focus on right side
        draw.ellipse([(int(w * 0.55), int(h * 0.20)), (int(w * 0.92), int(h * 0.90))], fill=(40, 48, 70))
        draw.text((int(w * 0.60), int(h * 0.45)), "DRAMA SCENE FOCUS", fill=(200, 210, 230))

        img.save(str(target_path), quality=95)
        return target_path


def get_image_provider(provider_name: str, headless: bool = False) -> ThumbnailImageProvider:
    """Factory to instantiate the appropriate image generation provider."""
    name = (provider_name or "playwright_chatgpt").lower().strip()
    if name in ["playwright", "playwright_chatgpt", "chatgpt"]:
        return PlaywrightChatGPTImageProvider(headless=headless)
    elif name in ["openai", "dalle", "dalle3"]:
        return OpenAIImageProvider()
    elif name in ["gemini", "imagen", "imagen3"]:
        return GeminiImageProvider()
    elif name == "mock":
        return MockCompositorProvider()
    else:
        logger.warning(f"Unknown image provider '{provider_name}'. Defaulting to PlaywrightChatGPTImageProvider.")
        return PlaywrightChatGPTImageProvider(headless=headless)
