@echo off
chcp 65001 >nul
title Mio v3.2.0-dev.1
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
set "MIO_PY=.venv\Scripts\python.exe"
goto check_dependencies

:use_venv2
echo 正在使用 venv 启动 Mio...
set "MIO_PY=venv\Scripts\python.exe"
goto check_dependencies

:use_python
echo 正在启动 Mio...
set "MIO_PY=python"
goto check_dependencies

:use_py
echo 正在启动 Mio...
set "MIO_PY=py"
goto check_dependencies

:check_dependencies
"%MIO_PY%" -c "from PIL import Image; v=tuple(map(int,Image.__version__.split('.')[:2])); assert (11,3) <= v < (13,0)" >nul 2>nul
if errorlevel 1 (
  echo 首次启动需要安装图片处理依赖。请在本目录运行：
  echo "%MIO_PY%" -m pip install -r packaging/requirements.txt
  echo 安装完成后重新双击 start.bat；启动器不会自动联网。
  goto end
)
"%MIO_PY%" server.py

:end
pause
