@echo off
rem Opens the Presenter Studio (teleprompter + animated AI presenter). Starts the console first if it is not running.
cd /d "%~dp0.."
curl -s -m 20 -o nul http://localhost:3000/studio.html >nul 2>nul
if errorlevel 1 (
  echo The console is not running, starting it...
  call run-all.bat
)
rem Edge has the natural-sounding online voices; fall back to the default browser.
where msedge >nul 2>nul
if not errorlevel 1 ( start "" msedge --new-window http://localhost:3000/studio.html ) else ( start "" http://localhost:3000/studio.html )
echo Studio opened. Press H in the page to hide the controls, F11 for full screen.
timeout /t 4 >nul
