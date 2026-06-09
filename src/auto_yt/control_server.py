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

PROJECT_ROOT = Path(__file__).resolve().parents[2]  # .../auto_YT
WORKER_CMD = [sys.executable, "-m", "auto_yt.worker"]
WORKER_CWD = str(PROJECT_ROOT / "src")

APP_CMD = [sys.executable, str(PROJECT_ROOT / "run_app.py")]
APP_CWD = str(PROJECT_ROOT)

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
_proc: subprocess.Popen | None = None       # Playwright worker
_app_lock = Lock()
_app_proc: subprocess.Popen | None = None   # Qt GUI app


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


def _clear_singleton_locks() -> None:
    """Remove Chrome lock files and reset crash markers left by unclean shutdowns."""
    import json as _json

    chrome_data = PROJECT_ROOT / "data" / "chrome_user_data"
    if not chrome_data.exists():
        return

    # 1. Remove Singleton* lock files
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        for lock in chrome_data.rglob(name):
            try:
                lock.unlink()
                log.info("Removed stale lock: %s", lock)
            except OSError as e:
                log.warning("Could not remove %s: %s", lock, e)

    # 2. Reset crash markers in each profile's Preferences so Chrome doesn't
    #    show the "Something went wrong opening your profile" dialog.
    for prefs_path in chrome_data.rglob("Preferences"):
        try:
            with open(prefs_path) as f:
                prefs = _json.load(f)
            changed = False

            # Reset exit_type / exited_cleanly
            profile = prefs.setdefault("profile", {})
            if profile.get("exit_type") != "Normal":
                profile["exit_type"] = "Normal"
                changed = True
            if profile.get("exited_cleanly") is not True:
                profile["exited_cleanly"] = True
                changed = True

            # Reset sessions: session_data_status=3 and crashed=True entries
            # trigger the "Something went wrong opening your profile" dialog.
            sessions = prefs.get("sessions", {})
            if sessions.get("session_data_status") not in (None, 0, 1):
                sessions["session_data_status"] = 1
                changed = True
            event_log = sessions.get("event_log", [])
            for entry in event_log:
                if entry.get("crashed") is True:
                    entry["crashed"] = False
                    changed = True

            if changed:
                with open(prefs_path, "w") as f:
                    _json.dump(prefs, f)
                log.info("Reset crash markers in %s", prefs_path)
        except Exception as e:
            log.warning("Could not reset Preferences at %s: %s", prefs_path, e)


def start_worker() -> dict:
    global _proc
    with _lock:
        if _is_running():
            return {"ok": False, "reason": "already_running", "pid": _proc.pid}
        _clear_singleton_locks()
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
            # SIGINT triggers KeyboardInterrupt in Python → worker runs
            # its finally block → ctx.close() → Chrome shuts down cleanly
            # (SIGTERM skips the finally block and force-kills Chrome)
            _proc.send_signal(signal.SIGINT)
            _proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            log.warning("Worker did not stop in 20s, force-killing")
            _proc.kill()
        _proc = None
        return {"ok": True, "pid": pid}


def get_status() -> dict:
    with _lock:
        running = _is_running()
    with _app_lock:
        app_running = _is_app_running()
    return {
        "running": running,
        "pid": _proc.pid if running else None,
        "app_running": app_running,
        "app_pid": _app_proc.pid if app_running else None,
    }


# ---------------------------------------------------------------------------
# Qt GUI app manager
# ---------------------------------------------------------------------------
def _is_app_running() -> bool:
    global _app_proc
    if _app_proc is None:
        return False
    if _app_proc.poll() is not None:
        log.info("Qt app exited with code %s", _app_proc.returncode)
        _app_proc = None
        return False
    return True


def start_app() -> dict:
    global _app_proc
    with _app_lock:
        if _is_app_running():
            return {"ok": False, "reason": "already_running", "pid": _app_proc.pid}
        log.info("Starting Qt app: %s (cwd=%s)", " ".join(APP_CMD), APP_CWD)
        _app_proc = subprocess.Popen(
            APP_CMD,
            cwd=APP_CWD,
            stdout=open(PROJECT_ROOT / "app.log", "a"),
            stderr=subprocess.STDOUT,
        )
        log.info("Qt app started, pid=%s", _app_proc.pid)
        return {"ok": True, "pid": _app_proc.pid}


def stop_app() -> dict:
    global _app_proc
    with _app_lock:
        if not _is_app_running():
            return {"ok": False, "reason": "not_running"}
        pid = _app_proc.pid
        log.info("Stopping Qt app pid=%s", pid)
        try:
            _app_proc.terminate()
            _app_proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _app_proc.kill()
        _app_proc = None
        return {"ok": True, "pid": pid}


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
        try:
            if self.path == "/start":
                self._json(start_worker())
            elif self.path == "/stop":
                self._json(stop_worker())
            elif self.path == "/app/start":
                self._json(start_app())
            elif self.path == "/app/stop":
                self._json(stop_app())
            else:
                self._json({"error": "not_found"}, 404)
        except Exception as exc:
            log.exception("Error handling POST %s", self.path)
            self._json({"ok": False, "error": str(exc)}, 500)

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
        stop_app()
        server.server_close()
