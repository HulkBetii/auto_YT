"""Central path constants for the auto_yt project."""

from __future__ import annotations

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

CONFIG_DIR = PROJECT_ROOT / "config"
DATA_DIR = PROJECT_ROOT / "data"

ACCOUNT_PATH = DATA_DIR / "account.json"
ACCOUNT_EXAMPLE_PATH = CONFIG_DIR / "account.example.json"
SESSION_PATH = DATA_DIR / "session_chatgpt.json"
