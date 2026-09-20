@echo off
setlocal enabledelayedexpansion
rem ==========================================================================================
rem  One-click launcher: agent (backend) + console (frontend) + browser.
rem  Everything is configured in .env (database, AI model, data folder). Edit .env, then run this.
rem  Ollama is expected to be running already (it runs as a Windows app); this script does not start it.
rem  The console shows a red banner if Ollama, the AI model or the TigerGraph database is not reachable.
rem    stop-all.bat   stops everything this script started
rem ==========================================================================================
cd /d "%~dp0"
title fraud-agent launcher

if not exist ".env" (
  echo ERROR: .env not found. Copy .env.example to .env and fill in TG_HOST and TG_SECRET.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Installing dependencies ^(first run only^)...
  call pnpm install
)

rem ---- TigerGraph workspace awake? (it auto-suspends after 60 idle minutes)
set "TG_HOST="
for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"TG_HOST=" .env') do set "TG_HOST=%%B"
if defined TG_HOST (
  curl -s -m 15 "!TG_HOST!/restpp/echo" | findstr /c:"Hello GSQL" >nul
  if errorlevel 1 (
    echo.
    echo WARNING: the TigerGraph workspace did not answer. It is probably suspended.
    echo Resume it in Savanna ^(workspace menu, Start/Resume^), wait until it is Active, then run this again.
    echo.
    pause
    exit /b 1
  ) else (
    echo TigerGraph workspace is awake.
  )
)

rem ---- agent on :4000 (reads .env itself)
curl -s -m 25 http://localhost:4000/api/health >nul 2>nul
if errorlevel 1 (
  echo Starting the agent on http://localhost:4000 ...
  start "fraud-backend" cmd /k "pnpm dev:backend"
) else (
  echo The agent is already running on :4000 ^(run stop-all.bat first if you changed .env^).
)

rem ---- console on :3000
curl -s -m 25 -o nul http://localhost:3000 >nul 2>nul
if errorlevel 1 (
  echo Starting the console on http://localhost:3000 ...
  start "fraud-frontend" cmd /k "pnpm dev:frontend"
) else (
  echo The console is already running on :3000.
)

rem ---- wait until both answer
echo.
echo Waiting for the servers...
set /a TRIES=0
:wait
set /a TRIES+=1
curl -s -m 25 http://localhost:4000/api/health >nul 2>nul
set B=%errorlevel%
curl -s -m 25 -o nul http://localhost:3000 >nul 2>nul
set F=%errorlevel%
if "%B%%F%"=="00" goto ready
if %TRIES% GEQ 30 goto timeout
timeout /t 2 /nobreak >nul
goto wait

:timeout
echo.
echo The servers did not answer in time. Look at the "fraud-backend" and "fraud-frontend" windows for the error.
pause
exit /b 1

:ready
echo.
echo ===========================================================
echo   Console:  http://localhost:3000     Agent: http://localhost:4000
echo   Settings: edit .env, then stop-all.bat and run-all.bat
echo   To stop everything: stop-all.bat
echo ===========================================================
start "" http://localhost:3000
timeout /t 5 >nul
endlocal
