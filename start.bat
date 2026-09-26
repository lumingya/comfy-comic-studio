@echo off
rem Mio Comic Studio launcher (Windows).  First run creates .venv and installs dependencies.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "PY=python"
where py >nul 2>&1 && set "PY=py -3"
if not exist ".venv\Scripts\python.exe" (
  echo [mio] creating .venv ...
  %PY% -m venv .venv || goto :nopython
)
set "VPY=%~dp0.venv\Scripts\python.exe"
for /f "usebackq delims=" %%h in (`"%VPY%" -c "import hashlib;print(hashlib.sha256(open('server/requirements.txt','rb').read()).hexdigest())"`) do set "WANT=%%h"
set "HAVE="
if exist ".venv\.mio-requirements" set /p HAVE=<".venv\.mio-requirements"
if not "%HAVE%"=="%WANT%" (
  echo [mio] installing dependencies ...
  "%VPY%" -m pip install -q -r server\requirements.txt || goto :fail
  > ".venv\.mio-requirements" echo %WANT%
)
if not exist "web\dist\index.html" echo [mio] web\dist not built: API only
cd server
"%VPY%" -m mio_server.update apply
if "%MIO_PORT%"=="" (set "PORT=8788") else (set "PORT=%MIO_PORT%")
echo [mio] http://127.0.0.1:%PORT%
start "" "http://127.0.0.1:%PORT%"
"%VPY%" -m mio_server %*
goto :eof

:nopython
echo [mio] Python 3.11+ is required: https://www.python.org/downloads/
pause
exit /b 1

:fail
echo [mio] dependency installation failed
pause
exit /b 1
