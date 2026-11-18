@echo off
title SkyClerik Home DOCK Updater
cd /d "%~dp0"

echo Starting SkyClerik Home DOCK Updater...
python update.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Updater exited with code %errorlevel%. Check if Python is installed.
    pause
)
