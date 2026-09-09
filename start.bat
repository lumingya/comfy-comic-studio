@echo off
chcp 65001 >nul
title ComfyComic Studio v0.0.1
echo =======================================================
echo   ComfyComic Studio v0.0.1 (Windows 工作台)
echo   本地服务与故事分镜系统启动中...
echo =======================================================
echo.

cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel% equ 0 (
    echo [启动模式] 使用系统 Python 启动...
    python server.py
    goto end
)

where py >nul 2>nul
if %errorlevel% equ 0 (
    echo [启动模式] 使用 Python Launcher (py) 启动...
    py server.py
    goto end
)

echo [错误] 未检测到 Python 运行时。
echo 请先安装 Python 3.10+ 并勾选 "Add Python to PATH"。
echo.

:end
pause
