@echo off
setlocal enabledelayedexpansion
rem ==========================================================================================
rem  LIVE DEMO DRIVER for the video. Run it in a big, clean terminal.
rem
rem    video\demo.bat          all steps, pausing before each one (you press a key to run it)
rem    video\demo.bat 3        just step 3 (for retakes)
rem
rem  Each step prints the command first (so viewers can read it), waits for a key, then runs it.
rem  Steps:  1 database check   2 tests   3 investigate HHG-014   4 read the answer
rem          5 model failure    6 backtest 7 open the console
rem ==========================================================================================
cd /d "%~dp0.."
title Fraud Investigator - live demo
chcp 65001 >nul
mode con: cols=120 lines=40 >nul 2>nul
set "ONLY=%~1"

if not "%ONLY%"=="" goto step%ONLY%

:step1
call :show "bash scripts/tg-check.sh"
bash scripts/tg-check.sh
if not "%ONLY%"=="" goto end

:step2
call :show "pnpm test"
call pnpm test
if not "%ONLY%"=="" goto end

:step3
call :show "pnpm --filter @fraud/backend run cases -- --only HHG-014 --write-graph --out data/out-demo"
call pnpm --filter @fraud/backend run cases -- --only HHG-014 --write-graph --out data/out-demo
if not "%ONLY%"=="" goto end

:step4
call :show "node video/show-case.mjs data/out-demo/HHG-014.json"
node video/show-case.mjs data/out-demo/HHG-014.json
if not "%ONLY%"=="" goto end

:step5
call :show "set LLM_MODEL_OLLAMA=no-such-model   (break the AI model on purpose)"
set "LLM_MODEL_OLLAMA=no-such-model"
call pnpm --filter @fraud/backend run cases -- --only HHG-019 --out data/out-fail
set "LLM_MODEL_OLLAMA="
if not "%ONLY%"=="" goto end

:step6
call :show "pnpm --filter @fraud/backend run backtest -- --limit 300"
call pnpm --filter @fraud/backend run backtest -- --limit 300
if not "%ONLY%"=="" goto end

:step7
call :show "run-all.bat"
call run-all.bat
goto end

:show
echo.
echo ============================================================================
echo   ^> %~1
echo ============================================================================
echo   (press any key to run)
pause >nul
echo.
exit /b 0

:end
echo.
echo   Done.
endlocal
