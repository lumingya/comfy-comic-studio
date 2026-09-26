@echo off
rem Mio Comic Studio launcher (Windows).  First run creates .venv and installs dependencies.
rem Arguments go to the server, e.g.  start.bat --port 8790   or   start.bat --check
rem Keep this file ASCII with CRLF line endings and keep logic out of it: cmd quoting is fragile
rem (no "for /f" over quoted commands).  Dependency checks live in server\bootstrap.py.
rem server\tests\test_launchers.py runs it for real in a path with spaces, CJK and "&".
setlocal
chcp 65001 >nul
rem UTF-8 stdio for Python and pip: non-ASCII folder names crash pip on other code pages.
set "PYTHONUTF8=1"
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" goto venv_ready
echo [mio] creating .venv ...
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY (where python >nul 2>&1 && set "PY=python")
if not defined PY goto nopython
%PY% -m venv .venv
if errorlevel 1 goto nopython
if not exist ".venv\Scripts\python.exe" goto nopython
:venv_ready
set "VPY=%CD%\.venv\Scripts\python.exe"
"%VPY%" server\bootstrap.py
if errorlevel 1 goto fail
if not exist "web\dist\index.html" echo [mio] web\dist not built: API only. Build the UI with: npm --prefix web run build
cd server
"%VPY%" -m mio_server.update apply
"%VPY%" -m mio_server --open %*
if errorlevel 1 goto crashed
goto end

:nopython
echo [mio] Python 3.11+ is required: https://www.python.org/downloads/
echo [mio] Tick "Add python.exe to PATH" when installing, then run start.bat again.
goto pause_exit

:fail
echo [mio] Mio could not start: dependencies are missing (see the messages above).
goto pause_exit

:crashed
echo [mio] The server stopped with an error (see the messages above).

:pause_exit
if not defined MIO_NO_PAUSE pause
exit /b 1

:end
endlocal
