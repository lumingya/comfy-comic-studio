@echo off
title ComfyComic Studio Backend
echo =======================================================
echo  正在启动 ComfyComic Studio 本地服务与物理落盘系统...
echo =======================================================
echo.
start "" "http://127.0.0.1:8777/index.html"
python "%~dp0server.py"
pause
