"""Postgres storage for GPT responses via asyncpg."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS gpt_responses (
    id          SERIAL PRIMARY KEY,
    account     TEXT        NOT NULL,
    prompt      TEXT        NOT NULL,
    response    TEXT        NOT NULL,
    model       TEXT        NOT NULL DEFAULT 'chatgpt',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""


async def save_response(
    dsn: str,
    *,
    account: str,
    prompt: str,
    response: str,
    model: str = "chatgpt",
) -> int:
    """
    Ensure table exists, insert one row, return new row id.

    Parameters
    ----------
    dsn : str
        Postgres connection string, e.g.
        postgres://user:pass@host/dbname?sslmode=require
    """
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(CREATE_TABLE_SQL)
        row_id = await conn.fetchval(
            """
            INSERT INTO gpt_responses (account, prompt, response, model)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            """,
            account, prompt, response, model,
        )
        logger.info("Saved response id=%s", row_id)
        return row_id
    finally:
        await conn.close()


async def fetch_recent(dsn: str, limit: int = 10) -> list[dict]:
    """Return the most recent rows as dicts."""
    conn = await asyncpg.connect(dsn)
    try:
        rows = await conn.fetch(
            "SELECT * FROM gpt_responses ORDER BY created_at DESC LIMIT $1",
            limit,
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()
