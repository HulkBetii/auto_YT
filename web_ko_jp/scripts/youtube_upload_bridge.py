"""
youtube_upload_bridge.py
========================
Adapter bridge script that runs under Nexus virtual environment Python (nexus_python).
Imports and invokes Nexus browser uploader directly without forking or duplicating code.
Communicates with web_ko_jp orchestrator via a Job JSON file and a JSONL event log file.
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import datetime
import json
from pathlib import Path
import re
import sys
import traceback
from typing import Any, Dict, Optional

sys.stdout.reconfigure(encoding="utf-8")


def emit_event(log_file: Path, event_type: str, **kwargs: Any) -> None:
    """Appends a structured JSON event to the JSONL log file and flushes immediately."""
    payload = {
        "type": event_type,
        "timestamp": datetime.now().isoformat(),
        **kwargs,
    }
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")
        f.flush()


def run_bridge(job_file: Path, log_file: Path) -> int:
    """Parses the job file, imports Nexus uploader services, and executes the specified action."""
    if not job_file.exists():
        emit_event(log_file, "error", error=f"Job file not found at {job_file}")
        return 1

    try:
        with open(job_file, encoding="utf-8") as f:
            job = json.load(f)
    except Exception as err:
        emit_event(log_file, "error", error=f"Failed to read job file: {err}", traceback=traceback.format_exc())
        return 1

    nexus_root = Path(job.get("nexus_root") or r"D:\VibeCoding\auto_upload\Nexus")
    nexus_src = nexus_root / "src"
    if str(nexus_src) not in sys.path:
        sys.path.insert(0, str(nexus_src))

    try:
        from auto_yt.services import browser_youtube_uploader as uploader
        from auto_yt.services import gpm_service
        from auto_yt.services.browser_youtube_uploader import (
            BrowserUploadError,
            BrowserUploadNeedsReview,
        )
    except ImportError as err:
        emit_event(
            log_file,
            "error",
            error=f"Failed to import Nexus services from {nexus_src}: {err}",
            traceback=traceback.format_exc(),
        )
        return 1

    # In-memory runtime adaptation: ensure Japanese language mapping is present
    if "ja" not in uploader.YOUTUBE_LANGUAGE_LABELS:
        uploader.YOUTUBE_LANGUAGE_LABELS["ja"] = ["Japanese", "Tiếng Nhật", "日本語"]

    # Modern 2026 YouTube Studio paid promotion selectors runtime patch
    try:
        import inspect
        adv_src = inspect.getsource(uploader._apply_advanced_details_settings)
        if "VIDEO_PAID_PRODUCT_PLACEMENT_NO" not in adv_src:
            adv_src = adv_src.replace(
                '"tp-yt-paper-radio-button[name=\'VIDEO_CONTAINS_PAID_PROMOTION_NO\']",',
                '"tp-yt-paper-radio-button[name=\'VIDEO_CONTAINS_PAID_PROMOTION_NO\']",\n'
                '            "tp-yt-paper-radio-button[name=\'VIDEO_PAID_PRODUCT_PLACEMENT_NO\']",\n'
                '            "ytcp-paid-product-placement-select tp-yt-paper-radio-button:has-text(\'No\')",\n'
                '            "ytcp-paid-product-placement-select tp-yt-paper-radio-button:has-text(\'Không\')",',
            )
            adv_src = adv_src.replace(
                '"tp-yt-paper-radio-button[name=\'VIDEO_CONTAINS_PAID_PROMOTION_YES\']",',
                '"tp-yt-paper-radio-button[name=\'VIDEO_CONTAINS_PAID_PROMOTION_YES\']",\n'
                '            "tp-yt-paper-radio-button[name=\'VIDEO_PAID_PRODUCT_PLACEMENT_NOTIFY\']",\n'
                '            "ytcp-paid-product-placement-select tp-yt-paper-radio-button:has-text(\'Yes\')",\n'
                '            "ytcp-paid-product-placement-select tp-yt-paper-radio-button:has-text(\'Có\')",',
            )
            adv_src = adv_src.replace(
                '"ytcp-uploads-dialog tp-yt-paper-checkbox:has-text(\'Cho phép chèn địa điểm tự động\')",',
                '"ytcp-uploads-dialog tp-yt-paper-checkbox:has-text(\'Cho phép chèn địa điểm tự động\')",\n'
                '            "ytcp-uploads-dialog ytcp-checkbox-lit:has-text(\'Allow automatic places\')",\n'
                '            "ytcp-checkbox-lit[aria-label=\'Allow automatic places\']",\n'
                '            "div#checkbox[aria-label=\'Allow automatic places\']",',
            )
            adv_src = adv_src.replace(
                '"ytcp-uploads-dialog tp-yt-paper-checkbox:has-text(\'tự động thêm khái niệm\')",',
                '"ytcp-uploads-dialog tp-yt-paper-checkbox:has-text(\'tự động thêm khái niệm\')",\n'
                '            "ytcp-uploads-dialog ytcp-checkbox-lit:has-text(\'Allow automatic concepts\')",\n'
                '            "ytcp-checkbox-lit[aria-label=\'Allow automatic concepts\']",\n'
                '            "div#checkbox[aria-label=\'Allow automatic concepts\']",',
            )
            adv_src = adv_src.replace(
                '"ytcp-uploads-dialog tp-yt-paper-checkbox:has-text(\'Cho phép nhúng\')",',
                '"ytcp-uploads-dialog tp-yt-paper-checkbox:has-text(\'Cho phép nhúng\')",\n'
                '            "#allow-embed ytcp-checkbox-lit",\n'
                '            "ytcp-form-checkbox#allow-embed ytcp-checkbox-lit",\n'
                '            "ytcp-checkbox-lit[aria-label=\'Allow embedding\']",\n'
                '            "div#checkbox[aria-label=\'Allow embedding\']",\n'
                '            "ytcp-uploads-dialog ytcp-checkbox-lit:has-text(\'Allow embedding\')",',
            )
            adv_src = adv_src.replace(
                '"tp-yt-paper-checkbox#show-ratings",',
                '"tp-yt-paper-checkbox#show-ratings",\n'
                '                    "ytcp-uploads-dialog ytcp-checkbox-lit:has-text(\'Show how many viewers like this video\')",\n'
                '                    "ytcp-uploads-dialog tp-yt-paper-checkbox:has-text(\'Show how many viewers like this video\')",\n'
                '                    "ytcp-checkbox-lit[aria-label*=\'like this video\']",\n'
                '                    "ytcp-checkbox-lit[aria-label*=\'viewers like\']",',
            )
            exec(adv_src, uploader.__dict__)
    except Exception as patch_err:
        emit_event(log_file, "warning", warning=f"Could not apply advanced details patch: {patch_err}")

    # Modern 2026 YouTube Studio dropdown selection patch
    try:
        orig_select_dropdown = uploader._select_dropdown_option

        async def patched_select_dropdown_option(
            page,
            *,
            trigger_selectors: list[str],
            option_labels: list[str],
            field_name: str,
        ) -> None:
            # 1. Pre-check: if trigger already displays any of option_labels, skip immediately
            for trigger_selector in trigger_selectors:
                try:
                    triggers = await page.query_selector_all(trigger_selector)
                    for trigger in triggers:
                        if await trigger.is_visible():
                            selected_text = str(await trigger.inner_text() or "").strip()
                            for label in option_labels:
                                if label.casefold() in selected_text.casefold():
                                    uploader.logger.info(
                                        "Thiết lập '%s' đã sẵn sàng: '%s' (text: '%s')",
                                        field_name,
                                        label,
                                        selected_text.replace("\n", " "),
                                    )
                                    return
                except Exception:
                    continue

            # 2. Open dropdown
            try:
                await uploader._require_click(
                    page,
                    trigger_selectors,
                    f"Không thể mở thiết lập {field_name}.",
                    timeout_ms=4000,
                )
            except Exception as click_err:
                uploader.logger.warning("Không thể click trigger cho %s: %s", field_name, click_err)
                return

            await asyncio.sleep(0.5)

            # 3. Search and click matching option across entire page (including outer body overlays)
            clicked = False
            for label in option_labels:
                escaped = label.replace("'", "\\'")
                candidates = [
                    f"tp-yt-paper-listbox tp-yt-paper-item:has-text('{escaped}')",
                    f"ytcp-text-menu tp-yt-paper-item:has-text('{escaped}')",
                    f"tp-yt-iron-dropdown:not([aria-hidden='true']) tp-yt-paper-item:has-text('{escaped}')",
                    f"[role='listbox'] [role='option']:has-text('{escaped}')",
                    f"[role='menu'] [role='menuitem']:has-text('{escaped}')",
                    f"tp-yt-paper-item:has-text('{escaped}')",
                    f"[role='option']:has-text('{escaped}')",
                ]
                for sel in candidates:
                    try:
                        locator = page.locator(sel).first
                        if await locator.is_visible(timeout=500):
                            await locator.click()
                            clicked = True
                            break
                    except Exception:
                        continue
                if clicked:
                    await asyncio.sleep(0.3)
                    for trigger_selector in trigger_selectors:
                        try:
                            trigger = await page.query_selector(trigger_selector)
                            if trigger:
                                selected_text = str(await trigger.inner_text() or "").casefold()
                                if label.casefold() in selected_text:
                                    return
                        except Exception:
                            continue
                    return

            # 4. Dismiss dropdown safely if still open
            try:
                await uploader._dismiss_dropdown_safely(page)
            except Exception:
                pass

            # 5. Check trigger again
            for trigger_selector in trigger_selectors:
                try:
                    trigger = await page.query_selector(trigger_selector)
                    if trigger:
                        text = str(await trigger.inner_text() or "").casefold()
                        for label in option_labels:
                            if label.casefold() in text:
                                return
                except Exception:
                    continue

            # 6. Fallback for non-critical default settings
            non_critical_defaults = {
                "bình luận": ["bật", "on"],
                "kiểm duyệt bình luận": ["cơ bản", "basic"],
                "đối tượng bình luận": ["bất kỳ ai", "mọi người", "anyone"],
                "thứ tự bình luận": ["hàng đầu", "top"],
                "giấy phép": ["giấy phép chuẩn của youtube", "standard youtube license"],
            }
            if field_name in non_critical_defaults:
                for default_val in non_critical_defaults[field_name]:
                    if any(default_val in lbl.casefold() for lbl in option_labels):
                        uploader.logger.warning(
                            "Không tìm thấy tuỳ chọn '%s' (%s), nhưng đây là giá trị mặc định của YouTube. Bỏ qua để tiếp tục.",
                            field_name,
                            option_labels,
                        )
                        return

            raise uploader.BrowserUploadError(
                f"Không tìm thấy giá trị {field_name}: {option_labels[0] if option_labels else ''}."
            )

        uploader._select_dropdown_option = patched_select_dropdown_option
    except Exception as patch_dd_err:
        emit_event(log_file, "warning", warning=f"Could not apply dropdown patch: {patch_dd_err}")

    # Modern 2026 YouTube Studio monetization and step detection patch
    try:
        orig_read_monetization_snapshot = uploader._read_monetization_snapshot
        orig_classify_monetization_snapshot = uploader._classify_monetization_snapshot
        orig_read_active_upload_step = uploader._read_active_upload_step

        async def patched_read_monetization_snapshot(page) -> dict[str, Any]:
            dialog = await uploader._find_visible_upload_details_dialog(page)
            if dialog is None:
                dialog = await page.query_selector(
                    "ytcp-uploads-dialog, ytcp-video-upload-dialog, ytcp-video-details, ytcp-video-metadata-editor"
                )
            if dialog is None:
                raise uploader.BrowserUploadError("Không tìm thấy upload dialog để nhận diện kiếm tiền.")
            return await dialog.evaluate(
                """
                root => {
                  const visible = node => {
                    if (!node) return false;
                    const style = window.getComputedStyle(node);
                    return style.display !== 'none' && style.visibility !== 'hidden';
                  };
                  const text = node => (node?.innerText || node?.textContent || '').trim();
                  const stepNodes = Array.from(root.querySelectorAll(
                    '#step-badge, .step-title, .step-label, ytcp-video-upload-progress, '
                    + 'ytcp-video-upload-progress-step, [role="tab"]'
                  )).filter(visible);
                  const stepText = stepNodes.map(text).filter(Boolean);
                  const bodyText = text(root);
                  const hasSelector = selector => Array.from(root.querySelectorAll(selector)).some(visible);
                  return {
                    stepText,
                    hasMonetization: hasSelector(
                      'ytcp-video-monetization, #monetization-step, '
                      + '[test-id="monetization-step"], [name="MONETIZATION_ON"], '
                      + 'tp-yt-paper-radio-button[name="ON"]'
                    ),
                    hasElements: /Các thành phần|Video elements|動画の要素/i.test(stepText.join(' | '))
                      || hasSelector('ytcp-video-elements'),
                    hasChecks: /Kiểm tra|Checks?|Initial check|チェック/i.test(stepText.join(' | '))
                      || hasSelector('ytcp-video-checks'),
                    hasVisibility: /Chế độ hiển thị|Visibility|公開設定/i.test(stepText.join(' | '))
                      || hasSelector('ytcp-video-visibility-select'),
                    explicitUnavailable: /chưa đủ điều kiện kiếm tiền|not eligible for monetization|monetization is not available/i.test(bodyText),
                  };
                }
                """
            )

        def patched_classify_monetization_snapshot(snapshot: dict[str, Any]):
            res = orig_classify_monetization_snapshot(snapshot)
            if res.capability is uploader.MonetizationCapability.UNKNOWN:
                step_text = " | ".join(snapshot.get("stepText", []))
                # 2026 YouTube Studio standard 4-step wizard: Details -> Video elements -> Initial check -> Visibility
                if re.search(r"Video elements|Các thành phần|動画の要素", step_text, re.I) and \
                   re.search(r"Visibility|Chế độ hiển thị|公開設定", step_text, re.I):
                    steps = tuple(str(item).strip() for item in snapshot.get("stepText", []) if str(item).strip())
                    return uploader.MonetizationDetection(
                        uploader.MonetizationCapability.UNAVAILABLE,
                        ("inferred_non_monetized_topology", *steps),
                    )
            return res

        async def patched_read_active_upload_step(page) -> str:
            dialog = await page.query_selector(uploader.UPLOAD_DIALOG_SELECTOR)
            if dialog is None:
                return "unknown"
            data = await dialog.evaluate(
                """
                root => {
                  const text = node => (node?.innerText || node?.textContent || '').trim();
                  const visible = node => {
                    if (!node) return false;
                    const style = window.getComputedStyle(node);
                    return style.display !== 'none' && style.visibility !== 'hidden'
                      && node.getClientRects().length > 0;
                  };
                  if (visible(root.querySelector('ytcp-video-elements'))) return 'elements';
                  if (visible(root.querySelector('ytcp-video-checks'))) return 'checks';
                  if (visible(root.querySelector('ytcp-video-visibility-select'))) return 'visibility';
                  const active = Array.from(root.querySelectorAll('[active], [aria-selected="true"]'))
                    .map(text).join(' | ');
                  if (/Các thành phần|Video elements|動画の要素/i.test(active)) return 'elements';
                  if (/Kiểm tra|Checks?|Initial check|チェック/i.test(active)) return 'checks';
                  if (/Chế độ hiển thị|Visibility|公開設定/i.test(active)) return 'visibility';
                  return 'unknown';
                }
                """
            )
            return str(data or "unknown")

        uploader._read_monetization_snapshot = patched_read_monetization_snapshot
        uploader._classify_monetization_snapshot = patched_classify_monetization_snapshot
        uploader._read_active_upload_step = patched_read_active_upload_step
    except Exception as patch_mon_err:
        emit_event(log_file, "warning", warning=f"Could not apply monetization patch: {patch_mon_err}")

    action = job.get("action", "upload")

    # -------------------------------------------------------------------------
    # ACTION: check
    # -------------------------------------------------------------------------
    if action == "check":
        try:
            gpm_res = gpm_service.check_gpm_connection()
            emit_event(log_file, "result", status="check_ok", gpm=gpm_res)
            return 0
        except Exception as err:
            emit_event(log_file, "error", error=f"Check failed: {err}", traceback=traceback.format_exc())
            return 1

    # -------------------------------------------------------------------------
    # ACTION: publish_now (make existing video public)
    # -------------------------------------------------------------------------
    if action == "publish_now":
        profile_id = job.get("profile_id", "")
        existing_video_id = job.get("existing_video_id", "")
        if not existing_video_id:
            emit_event(log_file, "error", error="existing_video_id is required for publish_now")
            return 1

        try:
            res = asyncio.run(
                uploader.make_video_public_via_browser(
                    profile_id=profile_id,
                    youtube_video_id=existing_video_id,
                    timeout_seconds=float(job.get("timeout_seconds", 90.0)),
                )
            )
            emit_event(
                log_file,
                "result",
                status="published",
                video_id=existing_video_id,
                details=res,
            )
            return 0
        except Exception as err:
            emit_event(
                log_file,
                "error",
                error=f"Failed to make video public: {err}",
                traceback=traceback.format_exc(),
            )
            return 1

    # -------------------------------------------------------------------------
    # ACTIONS: upload or schedule
    # -------------------------------------------------------------------------
    def on_progress(message: str, step: str, percent: int) -> None:
        emit_event(log_file, "progress", message=message, step=step, percent=percent)

    def on_video_id(vid: str) -> None:
        emit_event(log_file, "video_id", video_id=vid)

    def on_checkpoint(stage: str, details: Dict[str, Any]) -> None:
        emit_event(log_file, "checkpoint", stage=stage, details=details)

    schedule_at = None
    if job.get("schedule_at"):
        try:
            schedule_at = datetime.fromisoformat(job["schedule_at"])
        except Exception as err:
            emit_event(log_file, "error", error=f"Invalid schedule_at ISO string: {err}")
            return 1

    publish_mode = job.get("publish_mode", "private" if action == "upload" else "schedule")
    video_path = Path(job["video_path"]) if job.get("video_path") else None
    thumbnail_path = Path(job["thumbnail_path"]) if job.get("thumbnail_path") else None
    caption_path = Path(job["caption_path"]) if job.get("caption_path") else None

    pub_settings = dict(job.get(
        "publishing_settings",
        {"language": "ja", "title_description_language": "ja", "monetization_mode": "auto_enable_if_available"},
    ))
    if pub_settings.get("monetization_mode") == "auto":
        pub_settings["monetization_mode"] = "auto_enable_if_available"

    try:
        result = asyncio.run(
            uploader.upload_video_via_browser(
                profile_id=job["profile_id"],
                video_path=video_path,
                thumbnail_path=thumbnail_path,
                caption_path=caption_path,
                title=job.get("title", ""),
                description=job.get("description", ""),
                tags=job.get("tags") or [],
                category_id=str(job.get("category_id", "27")),
                made_for_kids=bool(job.get("made_for_kids", False)),
                contains_synthetic_media=bool(job.get("contains_synthetic_media", True)),
                notify_subscribers=bool(job.get("notify_subscribers", True)),
                schedule_at=schedule_at,
                publish_mode=publish_mode,
                language=job.get("language", "ja"),
                publishing_settings=pub_settings,
                publication_timezone=job.get("publication_timezone", "Asia/Tokyo"),
                expected_channel_id=job.get("expected_channel_id"),
                existing_video_id=job.get("existing_video_id"),
                progress=on_progress,
                persist_video_id=on_video_id,
                persist_checkpoint=on_checkpoint,
                timeout_seconds=float(job.get("timeout_seconds", 300.0)),
                auto_stop_gpm=job.get("auto_stop_gpm"),
            )
        )

        final_vid = result.get("youtube_video_id") or job.get("existing_video_id")
        final_status = result.get("status")
        if publish_mode == "private":
            final_stage = "draft_private"
        elif publish_mode == "schedule":
            final_stage = "scheduled"
        elif publish_mode == "public":
            final_stage = "published"
        else:
            final_stage = "draft_private"

        emit_event(
            log_file,
            "result",
            status=final_stage,
            video_id=final_vid,
            url=result.get("published_url") or (f"https://www.youtube.com/watch?v={final_vid}" if final_vid else ""),
            details=result,
        )
        return 0

    except BrowserUploadNeedsReview as exc:
        emit_event(
            log_file,
            "result",
            status="needs_review",
            video_id=getattr(exc, "video_id", None) or job.get("existing_video_id"),
            error=str(exc),
        )
        return 2

    except Exception as exc:
        emit_event(
            log_file,
            "error",
            error=str(exc),
            traceback=traceback.format_exc(),
        )
        return 1


def main():
    parser = argparse.ArgumentParser(description="YouTube Upload Bridge for web_ko_jp via Nexus")
    parser.add_argument("--job-file", type=Path, required=True, help="Path to job JSON file")
    parser.add_argument("--log-file", type=Path, required=True, help="Path to output JSONL log file")
    args = parser.parse_args()

    exit_code = run_bridge(args.job_file, args.log_file)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
