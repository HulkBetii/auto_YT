"""
test_publication_scheduler.py
=============================
Tests for publication slot selection in Asia/Tokyo timezone.
Verifies lead time buffers, collision avoidance, daily limits, and DST-safe arithmetic.
"""

from __future__ import annotations

import datetime as dt
import pytest
from zoneinfo import ZoneInfo

from publication_scheduler import (
    PublicationScheduleError,
    find_next_publication_slot,
    validate_publication_slots,
    validate_timezone,
)

TOKYO_TZ = "Asia/Tokyo"
DAILY_SLOTS = [{"day": d, "time": "20:00"} for d in range(7)]


def test_validate_timezone():
    assert validate_timezone("Asia/Tokyo") == "Asia/Tokyo"
    assert validate_timezone("UTC") == "UTC"
    with pytest.raises(ValueError, match="Invalid publication timezone"):
        validate_timezone("Invalid/Timezone_XYZ")


def test_validate_publication_slots():
    slots = [{"day": 0, "time": "20:00"}, {"day": 1, "time": "18:30"}]
    validated = validate_publication_slots(slots)
    assert len(validated) == 2
    assert validated[0]["time"] == "20:00"

    with pytest.raises(ValueError, match="HH:MM"):
        validate_publication_slots([{"day": 0, "time": "invalid"}])

    with pytest.raises(ValueError, match="duplicate"):
        validate_publication_slots([{"day": 0, "time": "20:00"}, {"day": 0, "time": "20:00"}])


def test_find_next_slot_same_day_with_sufficient_lead_time():
    # 10:00 JST (01:00 UTC) -> 20:00 JST (11:00 UTC) has 10 hours of lead time (> 120m)
    now_utc = dt.datetime(2026, 10, 10, 1, 0, 0, tzinfo=dt.timezone.utc)
    slot_iso = find_next_publication_slot(
        timezone_name=TOKYO_TZ,
        slots=DAILY_SLOTS,
        daily_limit=1,
        lead_minutes=120,
        occupied_utc=[],
        now_utc=now_utc,
    )
    # Expected: 2026-10-10 at 11:00:00 UTC (= 20:00 JST)
    expected_utc = dt.datetime(2026, 10, 10, 11, 0, 0, tzinfo=dt.timezone.utc).isoformat()
    assert slot_iso == expected_utc


def test_find_next_slot_skips_same_day_when_lead_time_insufficient():
    # 19:00 JST (10:00 UTC) -> 20:00 JST is only 60m away, but lead_minutes=120 requires >= 21:00 JST
    now_utc = dt.datetime(2026, 10, 10, 10, 0, 0, tzinfo=dt.timezone.utc)
    slot_iso = find_next_publication_slot(
        timezone_name=TOKYO_TZ,
        slots=DAILY_SLOTS,
        daily_limit=1,
        lead_minutes=120,
        occupied_utc=[],
        now_utc=now_utc,
    )
    # Must skip to tomorrow: 2026-10-11 at 11:00:00 UTC (= 20:00 JST)
    expected_utc = dt.datetime(2026, 10, 11, 11, 0, 0, tzinfo=dt.timezone.utc).isoformat()
    assert slot_iso == expected_utc


def test_find_next_slot_avoids_occupied_slots():
    # Morning of 2026-10-10, but 20:00 JST (11:00 UTC) is already occupied
    now_utc = dt.datetime(2026, 10, 10, 1, 0, 0, tzinfo=dt.timezone.utc)
    occupied = ["2026-10-10T11:00:00+00:00"]
    slot_iso = find_next_publication_slot(
        timezone_name=TOKYO_TZ,
        slots=DAILY_SLOTS,
        daily_limit=1,
        lead_minutes=120,
        occupied_utc=occupied,
        now_utc=now_utc,
    )
    # Should advance to next day 2026-10-11 at 11:00:00 UTC
    expected_utc = dt.datetime(2026, 10, 11, 11, 0, 0, tzinfo=dt.timezone.utc).isoformat()
    assert slot_iso == expected_utc


def test_find_next_slot_respects_daily_limit():
    # Morning of 2026-10-10, occupied on another slot on the same local day
    now_utc = dt.datetime(2026, 10, 10, 1, 0, 0, tzinfo=dt.timezone.utc)
    multi_slots = [
        {"day": d, "time": "12:00"} for d in range(7)
    ] + [
        {"day": d, "time": "20:00"} for d in range(7)
    ]
    # Day 2026-10-10 already has 1 published video at 12:00 JST (03:00 UTC)
    occupied = ["2026-10-10T03:00:00+00:00"]
    slot_iso = find_next_publication_slot(
        timezone_name=TOKYO_TZ,
        slots=multi_slots,
        daily_limit=1,
        lead_minutes=120,
        occupied_utc=occupied,
        now_utc=now_utc,
    )
    # Because daily_limit=1, the 20:00 slot on 2026-10-10 cannot be used; moves to 2026-10-11 at 12:00 JST (03:00 UTC)
    expected_utc = dt.datetime(2026, 10, 11, 3, 0, 0, tzinfo=dt.timezone.utc).isoformat()
    assert slot_iso == expected_utc
