import sys
from pathlib import Path

WEB_KO_JP_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = WEB_KO_JP_DIR / "scripts"
SRC_DIR = WEB_KO_JP_DIR.parent / "src"
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

for p in (SCRIPTS_DIR, SRC_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
