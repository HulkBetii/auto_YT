import json
import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
EMBEDDINGS_FILE = PROJECT_ROOT / "web/lib/openai/embeddings.ts"
WHISPER_TS_FILE = PROJECT_ROOT / "web_2/lib/pipeline/whisper.ts"
WHISPER_PY_FILE = PROJECT_ROOT / "src/auto_yt/render_worker.py"
SKIPPED_DIRECTORY_NAMES = {
    ".git",
    ".next",
    ".pytest_cache",
    ".venv",
    "__pycache__",
    "node_modules",
}


def _code_files():
    for folder in ("src", "tests", "web", "web_2", "web_3", "web_ko"):
        for root, directories, filenames in os.walk(PROJECT_ROOT / folder):
            directories[:] = [
                name
                for name in directories
                if name not in SKIPPED_DIRECTORY_NAMES
            ]
            for filename in filenames:
                path = Path(root) / filename
                if path == Path(__file__):
                    continue
                if path.suffix in {".py", ".ts", ".tsx", ".mts"}:
                    yield path


def test_openai_text_and_tts_apis_are_forbidden() -> None:
    forbidden = ("chat.completions", "responses.create", "audio.speech.create")
    for path in _code_files():
        content = path.read_text(encoding="utf-8")
        for marker in forbidden:
            assert marker not in content, f"Forbidden OpenAI API {marker} in {path}"


def test_openai_clients_and_http_calls_match_the_allowlist() -> None:
    for path in _code_files():
        content = path.read_text(encoding="utf-8")
        if "new OpenAI(" in content:
            assert path == EMBEDDINGS_FILE
        if "AsyncOpenAI(" in content:
            assert path == WHISPER_PY_FILE
        if "api.openai.com/v1" in content:
            assert path == WHISPER_TS_FILE


def test_javascript_openai_dependency_is_embeddings_only() -> None:
    web_package = json.loads((PROJECT_ROOT / "web/package.json").read_text(encoding="utf-8"))
    web2_package = json.loads((PROJECT_ROOT / "web_2/package.json").read_text(encoding="utf-8"))
    web3_package = json.loads((PROJECT_ROOT / "web_3/package.json").read_text(encoding="utf-8"))
    web_ko_package = json.loads((PROJECT_ROOT / "web_ko/package.json").read_text(encoding="utf-8"))

    assert "openai" in web_package["dependencies"]
    assert "openai" not in web2_package["dependencies"]
    assert "openai" not in web3_package["dependencies"]
    assert "openai" not in web_ko_package["dependencies"]
