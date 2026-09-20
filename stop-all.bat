@echo off
rem Stops the windows started by run-all.bat (backend, frontend) and anything left on ports 3000/4000.
title fraud-agent stop
taskkill /fi "WINDOWTITLE eq fraud-backend*" /t /f >nul 2>nul
taskkill /fi "WINDOWTITLE eq fraud-frontend*" /t /f >nul 2>nul
for %%P in (3000 4000) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do taskkill /pid %%I /t /f >nul 2>nul
)
echo Stopped.
timeout /t 3 >nul
