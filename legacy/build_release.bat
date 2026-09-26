@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul 2>&1
set "PYTHONUTF8=1"
set "MIO_EXIT=1"
set "MIO_PUSHED="
title Mio - Windows release builder
echo =======================================================
echo   Mio - Windows release builder
echo =======================================================
echo.

pushd "%~dp0"
if errorlevel 1 goto location_error
set "MIO_PUSHED=1"
if not exist "tools\build_release.py" goto missing_files

where python >nul 2>&1
if errorlevel 1 goto check_py
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if not errorlevel 1 goto run_python

:check_py
where py >nul 2>&1
if errorlevel 1 goto missing_python
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if not errorlevel 1 goto run_py
goto missing_python

:run_python
python "tools\build_release.py"
set "MIO_EXIT=%ERRORLEVEL%"
goto finish

:run_py
py -3 "tools\build_release.py"
set "MIO_EXIT=%ERRORLEVEL%"
goto finish

:missing_python
echo [Error] Python 3.10 or newer is required for building a release.
echo Install Python from https://www.python.org/ and enable Add Python to PATH.
goto finish

:missing_files
echo [Error] tools\build_release.py was not found. Extract the complete project.
goto finish

:location_error
echo [Error] Cannot open the Mio project folder.
goto finish

:finish
if "%MIO_EXIT%"=="0" goto cleanup
echo.
echo [Error] Build failed. See the message above.

:cleanup
if defined MIO_PUSHED popd
if defined MIO_NO_PAUSE goto return
echo.
pause

:return
endlocal & exit /b %MIO_EXIT%
