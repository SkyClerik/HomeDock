@echo off
chcp 65001 >nul
title SkyClerik Home DOCK v2 Server

:: Переходим в папку, где лежит сам bat-файл
cd /d "%~dp0"

echo Запуск SkyClerik Home DOCK v2...
python server.py

:: Если сервер упадет с ошибкой, окно не закроется сразу
if %errorlevel% neq 0 (
    echo.
    echo [ОШИБКА] Сервер завершился с кодом %errorlevel%. Проверьте, установлен ли Python.
    pause
)
