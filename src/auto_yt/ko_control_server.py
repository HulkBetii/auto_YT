"""Local start/stop server for the dedicated Korean Playwright worker."""

from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock

PORT = 4243
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = PROJECT_ROOT / "web_ko" / ".env.local"
WORKER_COMMAND = [sys.executable, "-m", "auto_yt.ko_worker"]
WORKER_CWD = PROJECT_ROOT
LOG_PATH = PROJECT_ROOT / "ko-worker.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [ko_control_server] %(message)s",
)
logger = logging.getLogger(__name__)

_lock = Lock()
_process: subprocess.Popen | None = None
_log_handle = None


def _load_environment() -> dict[str, str]:
    environment = os.environ.copy()
    if ENV_PATH.is_file():
        for raw_line in ENV_PATH.read_text(encoding="utf-8-sig").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                value = value[1:-1]
            environment[key.strip()] = value
    environment["PYTHONPATH"] = str(PROJECT_ROOT / "src")
    environment.setdefault("KO_WEB_URL", "http://127.0.0.1:3003")
    return environment


def _is_running() -> bool:
    global _process, _log_handle
    if _process is None:
        return False
    if _process.poll() is not None:
        logger.info("KO worker exited with code %s", _process.returncode)
        _process = None
        if _log_handle is not None:
            _log_handle.close()
            _log_handle = None
        return False
    return True


def start_worker() -> dict:
    global _process, _log_handle
    with _lock:
        if _is_running():
            return {"ok": False, "reason": "already_running", "pid": _process.pid}
        _log_handle = open(LOG_PATH, "a", encoding="utf-8")
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        _process = subprocess.Popen(
            WORKER_COMMAND,
            cwd=WORKER_CWD,
            env=_load_environment(),
            stdout=_log_handle,
            stderr=subprocess.STDOUT,
            creationflags=creation_flags,
        )
        logger.info("KO worker started with pid %s", _process.pid)
        return {"ok": True, "running": True, "pid": _process.pid}


def stop_worker() -> dict:
    global _process, _log_handle
    with _lock:
        if not _is_running():
            return {"ok": False, "reason": "not_running", "running": False}
        pid = _process.pid
        try:
            if os.name == "nt":
                _process.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                _process.send_signal(signal.SIGINT)
            _process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            logger.warning("KO worker did not stop gracefully; terminating pid %s", pid)
            _process.terminate()
            try:
                _process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _process.kill()
        _process = None
        if _log_handle is not None:
            _log_handle.close()
            _log_handle = None
        return {"ok": True, "running": False, "pid": pid}


def get_status() -> dict:
    with _lock:
        running = _is_running()
        return {
            "ok": True,
            "running": running,
            "pid": _process.pid if running else None,
        }


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/status":
            self._send_json(get_status())
        else:
            self._send_json({"ok": False, "error": "not_found"}, 404)

    def do_POST(self) -> None:
        try:
            if self.path == "/start":
                self._send_json(start_worker())
            elif self.path == "/stop":
                self._send_json(stop_worker())
            else:
                self._send_json({"ok": False, "error": "not_found"}, 404)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Control request failed")
            self._send_json({"ok": False, "error": str(exc)}, 500)

    def log_message(self, format_string: str, *args) -> None:
        logger.info("%s - %s", self.address_string(), format_string % args)


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    logger.info("KO control server listening on http://127.0.0.1:%s", PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        stop_worker()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
