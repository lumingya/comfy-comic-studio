@echo off
chcp 65001 >nul
title 打包 ComfyComic Studio 发行版
cd /d "%~dp0"
echo ========================================================
echo   ComfyComic Studio Windows 便携发行版打包工具
echo ========================================================
echo.
python tools/build_release.py
echo.
pause
