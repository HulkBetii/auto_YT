@echo off
chcp 65001 >nul
title Nexus Auto_YT - Tai 2000 Video Nen Background Footage

echo ==============================================================================
echo    NEXUS AUTO_YT - HE THONG TAI 2.000 VIDEO NEN (STOCK FOOTAGE)
echo ==============================================================================
echo.
echo Kiem tra cau hinh va API Key...
echo.

set PYTHON_CMD=python
where python >nul 2>nul
if %errorlevel% neq 0 (
    if exist "D:\VibeCoding\auto_upload\Nexus\Tool-auto-login-GPT\.venv\Scripts\python.exe" (
        set PYTHON_CMD="D:\VibeCoding\auto_upload\Nexus\Tool-auto-login-GPT\.venv\Scripts\python.exe"
    ) else (
        echo [LOI] Khong tim thay Python! Vui long kiem tra lai moi truong.
        pause
        exit /b 1
    )
)

%PYTHON_CMD% "D:\VibeCoding\auto_upload\Nexus\Tool-auto-login-GPT\scripts\download_background_videos.py" %*

echo.
echo ==============================================================================
echo Tien trinh da ket thuc hoac tam dung. Nhan phim bat ky de thoat.
echo ==============================================================================
pause
