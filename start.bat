@echo off
chcp 65001 >nul
title Mio v1.0.0
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" goto use_venv1
if exist "venv\Scripts\python.exe" goto use_venv2

where python >nul 2>nul
if %errorlevel% equ 0 goto use_python

where py >nul 2>nul
if %errorlevel% equ 0 goto use_py

echo 未找到 Python，请先安装 Python 3.10 或更高版本，并勾选 Add Python to PATH。
goto end

:use_venv1
echo 正在使用 .venv 启动 Mio...
".venv\Scripts\python.exe" server.py
goto end

:use_venv2
echo 正在使用 venv 启动 Mio...
"venv\Scripts\python.exe" server.py
goto end

:use_python
echo 正在启动 Mio...
python server.py
goto end

:use_py
echo 正在启动 Mio...
py server.py
goto end

:end
pause
