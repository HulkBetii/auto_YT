#!/usr/bin/env python3
"""
Local HTTP control server for the Playwright worker.

Runs on http://localhost:4242 so the Vercel dashboard (opened in the Mac's
browser) can start/stop the worker with a single button click.

Usage:
    python -m auto_yt.control_server
    # or
    python src/auto_yt/control_server.py
"""

from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Lock

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PORT = 4242
ALLOW_ORIGIN = "*"   # localhost-only server, safe to allow *

PROJECT_ROOT = Path(__file__).resolve().parents[3]  # .../auto_YT
WORKER_CMD = [sys.executable, "-m", "auto_yt.worker"]
WORKER_CWD = str(PROJECT_ROOT / "src")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [control_server] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Process manager
# ---------------------------------------------------------------------------
_lock = Lock()
_proc: subprocess.Popen | None = None


def _is_running() -> bool:
    global _proc
    if _proc is None:
        return False
    ret = _proc.poll()
    if ret is not None:
        log.info("Worker exited with code %s", ret)
        _proc = None
        return False
    return True


def start_worker() -> dict:
    global _proc
    with _lock:
        if _is_running():
            return {"ok": False, "reason": "already_running", "pid": _proc.pid}
        log.info("Starting worker: %s (cwd=%s)", " ".join(WORKER_CMD), WORKER_CWD)
        _proc = subprocess.Popen(
            WORKER_CMD,
            cwd=WORKER_CWD,
            stdout=open(PROJECT_ROOT / "worker.log", "a"),
            stderr=subprocess.STDOUT,
        )
        log.info("Worker started, pid=%s", _proc.pid)
        return {"ok": True, "pid": _proc.pid}


def stop_worker() -> dict:
    global _proc
    with _lock:
        if not _is_running():
            return {"ok": False, "reason": "not_running"}
        pid = _proc.pid
        log.info("Stopping worker pid=%s", pid)
        try:
            _proc.send_signal(signal.SIGTERM)
            _proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _proc.kill()
        _proc = None
        return {"ok": True, "pid": pid}


def get_status() -> dict:
    with _lock:
        running = _is_running()
        return {
            "running": running,
            "pid": _proc.pid if running else None,
        }


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _json(self, data: dict, code: int = 200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/status":
            self._json(get_status())
        else:
            self._json({"error": "not_found"}, 404)

    def do_POST(self):
        if self.path == "/start":
            self._json(start_worker())
        elif self.path == "/stop":
            self._json(stop_worker())
        else:
            self._json({"error": "not_found"}, 404)

    def log_message(self, fmt, *args):
        log.info("%s - %s", self.address_string(), fmt % args)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    log.info("Control server listening on http://localhost:%s", PORT)
    log.info("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down…")
        stop_worker()
        server.server_close()
