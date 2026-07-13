import asyncio
from datetime import datetime, timezone
from pathlib import Path

import pytest

from auto_yt.services.job_queue import _connect
from auto_yt.services.render_db import (
    claim_specific_render,
    mark_render_failed,
    owns_render_lease,
    save_render_done,
)


def _database_url() -> str:
    env_path = Path(__file__).resolve().parents[1] / "web" / ".env.local"
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.lstrip("\ufeff").strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "DATABASE_URL":
            return value.strip().strip("\"'")
    raise RuntimeError(f"Missing DATABASE_URL in {env_path}")


async def _insert_video(dsn: str, **overrides) -> int:
    values = {
        "title": "render-db-integration-test",
        "audio_url": "https://example.invalid/audio.mp3",
        "tts_text": "テストです。",
        "render_status": "not_started",
        "render_attempt_count": 0,
    }
    values.update(overrides)
    columns = ", ".join(values)
    placeholders = ", ".join(f"${index}" for index in range(1, len(values) + 1))
    conn = await _connect(dsn)
    try:
        return int(
            await conn.fetchval(
                f"INSERT INTO videos ({columns}) VALUES ({placeholders}) RETURNING id",
                *values.values(),
            )
        )
    finally:
        await conn.close()


async def _delete_video(dsn: str, video_id: int) -> None:
    conn = await _connect(dsn)
    try:
        await conn.execute("DELETE FROM video_content WHERE video_id = $1", video_id)
        await conn.execute("DELETE FROM videos WHERE id = $1", video_id)
    finally:
        await conn.close()


def test_specific_claim_is_concurrency_safe_and_owned() -> None:
    async def scenario() -> None:
        dsn = _database_url()
        video_id = await _insert_video(dsn)
        try:
            first, second = await asyncio.gather(
                claim_specific_render(dsn, video_id),
                claim_specific_render(dsn, video_id),
            )
            claimed = [row for row in (first, second) if row is not None]
            assert len(claimed) == 1
            token = str(claimed[0]["render_worker_token"])
            assert await owns_render_lease(dsn, video_id, token)
        finally:
            await _delete_video(dsn, video_id)

    asyncio.run(scenario())


def test_stale_specific_claim_replaces_old_lease() -> None:
    async def scenario() -> None:
        dsn = _database_url()
        video_id = await _insert_video(
            dsn,
            render_status="rendering",
            render_attempt_count=2,
            render_worker_token="old-token",
            render_started_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
            render_heartbeat_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
        )
        try:
            claimed = await claim_specific_render(dsn, video_id)
            assert claimed is not None
            assert claimed["render_worker_token"] != "old-token"
            assert claimed["render_attempt_count"] == 1
            assert not await owns_render_lease(dsn, video_id, "old-token")
        finally:
            await _delete_video(dsn, video_id)

    asyncio.run(scenario())


def test_retry_backoff_and_terminal_failure() -> None:
    async def scenario() -> None:
        dsn = _database_url()
        video_id = await _insert_video(dsn)
        conn = await _connect(dsn)
        try:
            expected_delays = {1: 60, 2: 300, 3: 900, 4: None}
            for attempt, expected_delay in expected_delays.items():
                token = f"token-{attempt}"
                await conn.execute(
                    """
                    UPDATE videos
                    SET render_status = 'rendering',
                        render_attempt_count = $2,
                        render_worker_token = $3
                    WHERE id = $1
                    """,
                    video_id,
                    attempt,
                    token,
                )
                await mark_render_failed(dsn, video_id, token, "test failure")
                row = await conn.fetchrow(
                    """
                    SELECT render_status, render_next_attempt_at,
                           EXTRACT(EPOCH FROM render_next_attempt_at - now()) AS delay
                    FROM videos WHERE id = $1
                    """,
                    video_id,
                )
                assert row["render_status"] == "failed"
                if expected_delay is None:
                    assert row["render_next_attempt_at"] is None
                else:
                    assert expected_delay - 10 <= float(row["delay"]) <= expected_delay + 10
        finally:
            await conn.close()
            await _delete_video(dsn, video_id)

    asyncio.run(scenario())

def test_render_completion_and_description_history_share_transaction() -> None:
    async def scenario() -> None:
        dsn = _database_url()
        video_id = await _insert_video(
            dsn,
            render_status="rendering",
            render_attempt_count=1,
            render_worker_token="active-token",
        )
        conn = await _connect(dsn)
        try:
            await conn.execute(
                """
                INSERT INTO video_content (video_id, stage, output)
                VALUES ($1, 'P_desc', 'old description')
                """,
                video_id,
            )

            with pytest.raises(RuntimeError, match="Lost render lease"):
                await save_render_done(
                    dsn,
                    video_id,
                    "wrong-token",
                    video_path="unused.mp4",
                    audio_url="https://example.invalid/audio.mp3",
                    source_hash="source-hash",
                    description_output="must not be inserted",
                )
            assert not await conn.fetchval(
                """
                SELECT EXISTS(
                  SELECT 1 FROM video_content
                  WHERE video_id = $1 AND output = 'must not be inserted'
                )
                """,
                video_id,
            )

            await save_render_done(
                dsn,
                video_id,
                "active-token",
                video_path="final_video.mp4",
                audio_url="https://example.invalid/audio.mp3",
                source_hash="source-hash",
                description_output="resolved description",
            )
            row = await conn.fetchrow(
                """
                SELECT render_status, video_path
                FROM videos
                WHERE id = $1
                """,
                video_id,
            )
            descriptions = await conn.fetch(
                """
                SELECT output
                FROM video_content
                WHERE video_id = $1 AND stage = 'P_desc'
                ORDER BY id
                """,
                video_id,
            )
            assert row["render_status"] == "done"
            assert row["video_path"] == "final_video.mp4"
            assert [item["output"] for item in descriptions] == [
                "old description",
                "resolved description",
            ]
        finally:
            await conn.close()
            await _delete_video(dsn, video_id)

    asyncio.run(scenario())
