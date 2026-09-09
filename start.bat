@echo off
chcp 65001 >nul
title Mio v1.0.0

cd /d "%~dp0"

echo =======================================================
echo   Mio v1.0.0 (Windows 工作台)
echo   本地服务与故事分镜系统启动中...
echo =======================================================
echo.

if exist ".venv\Scripts\python.exe" goto use_venv1
if exist "venv\Scripts\python.exe" goto use_venv2

where python >nul 2>nul
if %errorlevel% equ 0 goto use_python

where py >nul 2>nul
if %errorlevel% equ 0 goto use_py

echo [错误] 未检测到 Python 运行时。
echo 请先安装 Python 3.10+ 并勾选 "Add Python to PATH"。
echo.
goto end

:use_venv1
echo [启动模式] 使用本地虚拟环境 (.venv) 启动...
".venv\Scripts\python.exe" server.py
goto end

:use_venv2
echo [启动模式] 使用本地虚拟环境 (venv) 启动...
"venv\Scripts\python.exe" server.py
goto end

:use_python
echo [启动模式] 使用系统 Python 启动...
python server.py
goto end

:use_py
echo [启动模式] 使用 Python Launcher (py) 启动...
py server.py
goto end

:end
pause
