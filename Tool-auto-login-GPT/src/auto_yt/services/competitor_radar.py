"""Competitor channel discovery, isolated feed retrieval, and scan scheduling."""

from __future__ import annotations

import datetime as dt
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any, Iterable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from auto_yt.services import channel_scanner_service
from auto_yt.services.proxy_utils import create_proxy_opener, parse_proxy_url


BASELINE_VIDEO_COUNT = 15
PREDICTED_WINDOW_MINUTES = 60
PREDICTED_SCAN_SECONDS = 2 * 60
COLD_START_SCAN_SECONDS = 5 * 60
OFF_WINDOW_SCAN_SECONDS = 20 * 60
MAX_FEED_BYTES = 2 * 1024 * 1024
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com"}
CHANNEL_ID_PATTERN = re.compile(r"\bUC[A-Za-z0-9_-]{20,30}\b")


class CompetitorRadarError(RuntimeError):
    """Base error for deterministic competitor Radar failures."""


class CompetitorResolutionError(CompetitorRadarError):
    """Raised when a competitor reference cannot be resolved through GPM."""


def normalize_competitor_reference(value: str) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        raise ValueError("Vui lòng nhập URL, handle hoặc Channel ID của đối thủ.")
    if CHANNEL_ID_PATTERN.fullmatch(cleaned):
        return f"https://www.youtube.com/channel/{cleaned}"
    if cleaned.startswith("@"):
        handle = cleaned[1:].strip()
        if not handle or not re.fullmatch(r"[A-Za-z0-9._-]+", handle):
            raise ValueError("Handle YouTube không hợp lệ.")
        return f"https://www.youtube.com/@{handle}"
    if "://" not in cleaned:
        cleaned = "https://" + cleaned
    parsed = urllib.parse.urlsplit(cleaned)
    host = (parsed.hostname or "").casefold()
    if host not in YOUTUBE_HOSTS:
        raise ValueError("Radar chỉ chấp nhận URL kênh youtube.com.")
    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    if not (
        path.startswith("/@")
        or path.startswith("/channel/")
        or path.startswith("/c/")
        or path.startswith("/user/")
    ):
        raise ValueError("URL phải trỏ tới một kênh YouTube.")
    return urllib.parse.urlunsplit(("https", "www.youtube.com", path.rstrip("/"), "", ""))


async def resolve_competitor_channel(reference: str, gpm_profile_id: str) -> dict[str, str]:
    """Resolve a channel only through the target channel's authenticated GPM profile."""
    target_url = normalize_competitor_reference(reference)
    profile_id = str(gpm_profile_id or "").strip()
    if not profile_id:
        raise CompetitorResolutionError("Kênh đích chưa có GPM profile; Radar đã dừng an toàn.")

    async with channel_scanner_service.channel_browser_session(
        profile_id,
        target_url=target_url,
        timeout_seconds=45,
    ) as (context, _browser, _profile):
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto(target_url, wait_until="domcontentloaded", timeout=45_000)
        await page.wait_for_timeout(800)
        current_url = str(page.url or target_url)
        html = await page.content()
        title = str(await page.title() or "").replace(" - YouTube", "").strip()
        canonical = await page.locator('link[rel="canonical"]').get_attribute("href")
        thumbnail = await page.locator('meta[property="og:image"]').get_attribute("content")
        handle = ""
        parsed_path = urllib.parse.urlsplit(str(canonical or current_url)).path
        handle_match = re.search(r"/@([^/?#]+)", parsed_path)
        if handle_match:
            handle = "@" + urllib.parse.unquote(handle_match.group(1))

    channel_id = ""
    for pattern in (
        r'"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{20,30})"',
        r'"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{20,30})"',
        r'/channel/(UC[A-Za-z0-9_-]{20,30})',
    ):
        match = re.search(pattern, html)
        if match:
            channel_id = match.group(1)
            break
    if not channel_id:
        match = CHANNEL_ID_PATTERN.search(target_url)
        channel_id = match.group(0) if match else ""
    if not channel_id:
        raise CompetitorResolutionError(
            "Không tìm thấy Channel ID trong trang YouTube qua GPM."
        )
    return {
        "channel_id": channel_id,
        "canonical_url": f"https://www.youtube.com/channel/{channel_id}",
        "handle": handle,
        "title": title or handle or channel_id,
        "thumbnail_url": str(thumbnail or ""),
    }


def _text(node: ET.Element | None) -> str:
    return str(node.text or "").strip() if node is not None else ""


def parse_channel_feed(xml_bytes: bytes, *, limit: int = BASELINE_VIDEO_COUNT) -> list[dict[str, str]]:
    if not xml_bytes:
        raise CompetitorRadarError("RSS đối thủ trả về nội dung rỗng.")
    if len(xml_bytes) > MAX_FEED_BYTES:
        raise CompetitorRadarError("RSS đối thủ vượt giới hạn kích thước an toàn.")
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise CompetitorRadarError("RSS đối thủ không phải XML hợp lệ.") from exc
    namespaces = {
        "atom": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/",
    }
    videos: list[dict[str, str]] = []
    for entry in root.findall("atom:entry", namespaces):
        video_id = _text(entry.find("yt:videoId", namespaces))
        if not video_id:
            continue
        link_node = entry.find("atom:link[@rel='alternate']", namespaces)
        link = str(link_node.attrib.get("href") or "") if link_node is not None else ""
        videos.append(
            {
                "youtube_video_id": video_id,
                "url": link or f"https://www.youtube.com/watch?v={video_id}",
                "title": _text(entry.find("atom:title", namespaces)),
                "published_at": _text(entry.find("atom:published", namespaces)),
                "updated_at": _text(entry.find("atom:updated", namespaces)),
            }
        )
        if len(videos) >= max(1, int(limit)):
            break
    if not videos:
        raise CompetitorRadarError("RSS đối thủ không chứa video hợp lệ.")
    return videos


def fetch_channel_feed(
    channel_id: str,
    raw_proxy: str,
    *,
    timeout_seconds: float = 30.0,
    limit: int = BASELINE_VIDEO_COUNT,
) -> list[dict[str, str]]:
    """Fetch an RSS feed through the assigned proxy, with no direct fallback."""
    clean_channel_id = str(channel_id or "").strip()
    if not CHANNEL_ID_PATTERN.fullmatch(clean_channel_id):
        raise CompetitorRadarError("Channel ID đối thủ không hợp lệ.")
    if not parse_proxy_url(raw_proxy):
        raise CompetitorRadarError("Kênh đích chưa có proxy hợp lệ; Radar đã dừng an toàn.")
    opener = create_proxy_opener(raw_proxy, require_proxy=True)
    request = urllib.request.Request(
        "https://www.youtube.com/feeds/videos.xml?channel_id="
        + urllib.parse.quote(clean_channel_id, safe=""),
        headers={"User-Agent": "Auto-YT-Competitor-Radar/1.0"},
        method="GET",
    )
    with opener.open(request, timeout=timeout_seconds) as response:
        content_type = str(response.headers.get("Content-Type") or "").casefold()
        if content_type and "xml" not in content_type and "atom" not in content_type:
            raise CompetitorRadarError("YouTube RSS trả về kiểu nội dung không hợp lệ.")
        data = response.read(MAX_FEED_BYTES + 1)
    return parse_channel_feed(data, limit=limit)


def parse_utc(value: str | dt.datetime | None) -> dt.datetime | None:
    if isinstance(value, dt.datetime):
        parsed = value
    else:
        cleaned = str(value or "").strip()
        if not cleaned:
            return None
        try:
            parsed = dt.datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def _minute_of_week(moment: dt.datetime) -> int:
    return moment.weekday() * 24 * 60 + moment.hour * 60 + moment.minute


def _circular_minute_distance(left: int, right: int) -> int:
    week = 7 * 24 * 60
    delta = abs(left - right)
    return min(delta, week - delta)


def _parse_clock(value: str) -> int | None:
    match = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", str(value or "").strip())
    if not match:
        return None
    return int(match.group(1)) * 60 + int(match.group(2))


def is_in_manual_window(
    now: dt.datetime,
    windows: Iterable[dict[str, Any]],
    *,
    timezone_name: str,
) -> bool:
    try:
        local_now = now.astimezone(ZoneInfo(timezone_name or "Asia/Ho_Chi_Minh"))
    except ZoneInfoNotFoundError:
        local_now = now.astimezone(dt.timezone.utc)
    current = local_now.hour * 60 + local_now.minute
    weekday = local_now.weekday()
    for window in windows:
        if not isinstance(window, dict):
            continue
        days = window.get("days", list(range(7)))
        if not isinstance(days, list):
            continue
        start = _parse_clock(str(window.get("start") or ""))
        end = _parse_clock(str(window.get("end") or ""))
        if start is None or end is None:
            continue
        if start <= end and weekday in days and start <= current <= end:
            return True
        if start > end:
            if weekday in days and current >= start:
                return True
            if (weekday - 1) % 7 in days and current <= end:
                return True
    return False


def next_scan_delay_seconds(
    *,
    published_times: Iterable[str | dt.datetime],
    now: dt.datetime | None = None,
    window_mode: str = "learned",
    manual_windows: Iterable[dict[str, Any]] = (),
    timezone_name: str = "Asia/Ho_Chi_Minh",
) -> int:
    current = now or dt.datetime.now(dt.timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=dt.timezone.utc)
    current = current.astimezone(dt.timezone.utc)
    if str(window_mode).casefold() == "manual":
        return (
            PREDICTED_SCAN_SECONDS
            if is_in_manual_window(current, manual_windows, timezone_name=timezone_name)
            else OFF_WINDOW_SCAN_SECONDS
        )
    samples = [parsed for value in published_times if (parsed := parse_utc(value))]
    if len(samples) < 5:
        return COLD_START_SCAN_SECONDS
    current_minute = _minute_of_week(current)
    in_window = any(
        _circular_minute_distance(current_minute, _minute_of_week(sample))
        <= PREDICTED_WINDOW_MINUTES
        for sample in samples
    )
    return PREDICTED_SCAN_SECONDS if in_window else OFF_WINDOW_SCAN_SECONDS


def next_scan_at(
    *,
    published_times: Iterable[str | dt.datetime],
    now: dt.datetime | None = None,
    window_mode: str = "learned",
    manual_windows: Iterable[dict[str, Any]] = (),
    timezone_name: str = "Asia/Ho_Chi_Minh",
) -> str:
    current = now or dt.datetime.now(dt.timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=dt.timezone.utc)
    delay = next_scan_delay_seconds(
        published_times=published_times,
        now=current,
        window_mode=window_mode,
        manual_windows=manual_windows,
        timezone_name=timezone_name,
    )
    return (current.astimezone(dt.timezone.utc) + dt.timedelta(seconds=delay)).isoformat()


def scan_error_delay_seconds(error_count: int) -> int:
    return (60, 300, 900, 1800)[min(max(0, int(error_count)), 3)]
