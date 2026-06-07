"""PyQt6 login window and background worker for ChatGPT auto login."""

from __future__ import annotations

import asyncio
import json
import logging

from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtWidgets import (
    QCheckBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from auto_yt.paths import ACCOUNT_PATH, DATA_DIR, SESSION_PATH
from auto_yt.services.chatgpt_login import ChatGPTLoginError, login_gpt_auto

WINDOW_TITLE = "ChatGPT Auto Login"
WINDOW_WIDTH = 520
WINDOW_HEIGHT = 480


# --- Worker thread -------------------------------------------------------

class LoginWorker(QThread):
    """Run login_gpt_auto in a background thread with its own asyncio loop."""

    log = pyqtSignal(str)
    finished = pyqtSignal(dict)

    def __init__(self, account: dict, parent=None):
        super().__init__(parent)
        self.account = account

    def run(self):
        asyncio.run(self._run_login())

    async def _run_login(self):
        from playwright.async_api import async_playwright

        playwright = None
        browser = None
        context = None
        page = None

        try:
            self.log.emit("🚀 Launching browser...")
            playwright = await async_playwright().start()
            browser = await playwright.chromium.launch(
                headless=False,
                args=["--disable-blink-features=AutomationControlled"],
            )
            context = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()
            page.set_default_timeout(60_000)

            handler = _SignalLogHandler(self.log)
            login_logger = logging.getLogger("auto_yt.services.chatgpt_login")
            login_logger.addHandler(handler)
            login_logger.setLevel(logging.INFO)

            self.log.emit("🔐 Starting login flow...")
            result = await login_gpt_auto(self.account, page)

            login_logger.removeHandler(handler)

            DATA_DIR.mkdir(parents=True, exist_ok=True)
            SESSION_PATH.write_text(
                json.dumps(result, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            self.log.emit(f"💾 Session saved to {SESSION_PATH.name}")
            self.finished.emit(result)

        except ChatGPTLoginError as exc:
            self.log.emit(f"❌ {exc.__class__.__name__}: {exc}")
            self.finished.emit({"success": False, "error": str(exc), "type": exc.__class__.__name__})

        except Exception as exc:
            self.log.emit(f"❌ Unexpected: {exc}")
            self.finished.emit({"success": False, "error": str(exc), "type": "Exception"})

        finally:
            for resource in (page, context, browser):
                if resource:
                    try:
                        await resource.close()
                    except Exception:
                        pass
            if playwright:
                try:
                    await playwright.stop()
                except Exception:
                    pass


class _SignalLogHandler(logging.Handler):
    """Forward log records to a pyqtSignal(str)."""

    def __init__(self, signal: pyqtSignal):
        super().__init__()
        self._signal = signal

    def emit(self, record: logging.LogRecord):
        try:
            self._signal.emit(self.format(record))
        except Exception:
            pass


# --- Main window ---------------------------------------------------------

class LoginWindow(QWidget):
    def __init__(self):
        super().__init__()
        self._worker: LoginWorker | None = None
        self._init_ui()
        self._load_config()

    def _init_ui(self):
        self.setWindowTitle(WINDOW_TITLE)
        self.setFixedSize(WINDOW_WIDTH, WINDOW_HEIGHT)

        layout = QVBoxLayout(self)
        layout.setSpacing(8)

        # --- Email ---
        layout.addWidget(QLabel("Email"))
        self.email_input = QLineEdit()
        self.email_input.setPlaceholderText("you@example.com")
        layout.addWidget(self.email_input)

        # --- Password ---
        layout.addWidget(QLabel("Password"))
        password_row = QHBoxLayout()
        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setPlaceholderText("••••••••")
        password_row.addWidget(self.password_input)

        self.show_password_cb = QCheckBox("Show")
        self.show_password_cb.toggled.connect(self._toggle_password)
        password_row.addWidget(self.show_password_cb)
        layout.addLayout(password_row)

        # --- TOTP Secret ---
        layout.addWidget(QLabel("TOTP Secret (MFA)"))
        self.totp_input = QLineEdit()
        self.totp_input.setPlaceholderText("Base32 secret (optional)")
        layout.addWidget(self.totp_input)

        # --- Buttons row ---
        btn_row = QHBoxLayout()

        self.save_btn = QPushButton("💾  Save")
        self.save_btn.setFixedHeight(38)
        self.save_btn.clicked.connect(self._on_save)
        btn_row.addWidget(self.save_btn)

        self.login_btn = QPushButton("🔐  Auto Login")
        self.login_btn.setFixedHeight(38)
        self.login_btn.clicked.connect(self._on_login)
        btn_row.addWidget(self.login_btn)

        layout.addLayout(btn_row)

        # --- Log area ---
        layout.addWidget(QLabel("Log"))
        self.log_area = QTextEdit()
        self.log_area.setReadOnly(True)
        layout.addWidget(self.log_area, stretch=1)

        # --- Status bar ---
        self.status_label = QLabel("")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.status_label)

    # --- Config persistence -----------------------------------------------

    def _load_config(self):
        if not ACCOUNT_PATH.exists():
            return
        try:
            data = json.loads(ACCOUNT_PATH.read_text(encoding="utf-8"))
            self.email_input.setText(data.get("email", ""))
            self.password_input.setText(data.get("password", ""))
            self.totp_input.setText(data.get("totp_secret", ""))
        except Exception:
            pass

    def _save_config(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        data = {
            "email": self.email_input.text().strip(),
            "password": self.password_input.text(),
            "totp_secret": self.totp_input.text().strip(),
        }
        ACCOUNT_PATH.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # --- UI callbacks -----------------------------------------------------

    def _toggle_password(self, checked: bool):
        mode = QLineEdit.EchoMode.Normal if checked else QLineEdit.EchoMode.Password
        self.password_input.setEchoMode(mode)

    def _on_save(self):
        self._save_config()
        self._log("💾 Account saved.")
        self.status_label.setText("💾 Saved")
        self.status_label.setStyleSheet("color: #2196F3; font-weight: bold;")

    def _on_login(self):
        email = self.email_input.text().strip()
        password = self.password_input.text()

        if not email or not password:
            self._log("⚠️  Email and Password are required.")
            return

        self._save_config()
        self.log_area.clear()
        self._set_running(True)

        account = {
            "email": email,
            "password": password,
            "totp_secret": self.totp_input.text().strip() or None,
        }

        self._worker = LoginWorker(account)
        self._worker.log.connect(self._log)
        self._worker.finished.connect(self._on_finished)
        self._worker.start()

    def _on_finished(self, result: dict):
        self._set_running(False)
        self._worker = None

        if result.get("success"):
            user = result.get("user", {})
            cookies = result.get("cookies", [])
            self._log("✅ Login successful!")
            self._log(f"   User: {user.get('name', '')} ({user.get('email', '')})")
            self._log(f"   Plan: {user.get('plan', 'N/A')}")
            self._log(f"   Cookies: {len(cookies)} captured")
            self.status_label.setText("✅ Login successful")
            self.status_label.setStyleSheet("color: green; font-weight: bold;")
        else:
            error_type = result.get("type", "Error")
            error_msg = result.get("error", "Unknown error")
            self._log(f"❌ Failed — {error_type}: {error_msg}")
            self.status_label.setText(f"❌ {error_type}")
            self.status_label.setStyleSheet("color: red; font-weight: bold;")

    def _set_running(self, running: bool):
        self.login_btn.setEnabled(not running)
        self.save_btn.setEnabled(not running)
        self.login_btn.setText("⏳  Logging in..." if running else "🔐  Auto Login")
        if running:
            self.status_label.setText("⏳ Running...")
            self.status_label.setStyleSheet("color: orange; font-weight: bold;")

    def _log(self, message: str):
        self.log_area.append(message)
        scrollbar = self.log_area.verticalScrollBar()
        if scrollbar:
            scrollbar.setValue(scrollbar.maximum())
