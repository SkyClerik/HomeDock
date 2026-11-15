@echo off
title SkyClerik Home DOCK v2 Server
cd /d "%~dp0"

echo Starting SkyClerik Home DOCK v2...
python server.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server exited with code %errorlevel%. Check if Python is installed.
    pause
)
