@echo off
setlocal EnableExtensions
cd /d "%~dp0Tool-auto-login-GPT"
set PYTHONPATH=src
set PYTHONIOENCODING=utf-8
echo Dang mo Trinh duyet Google Flow (PROFILE_GOOGLE_FLOW_1)...
.venv\Scripts\python.exe -c "from auto_yt.services import google_flow_browser_service; status = google_flow_browser_service.set_browser_service_window_visibility(True); print(status.get('message', ''))"
if errorlevel 1 (
    echo Khong the mo trinh duyet Google Flow.
    pause
)
