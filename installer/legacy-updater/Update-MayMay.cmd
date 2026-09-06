@echo off
color 0B
title MayMay Legacy Updater
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-MayMay.ps1"
if errorlevel 1 (
  echo.
  echo The update did not finish. Read the message above or open:
  echo %LOCALAPPDATA%\MayMay-legacy-update.log
)
echo.
pause

