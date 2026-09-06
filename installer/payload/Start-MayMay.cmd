@echo off
color 0B
title MayMay Host
cd /d "%~dp0app"
if not exist "config\firebase-admin.json" (
  echo.
  echo MayMay needs its Firebase Admin key before it can start.
  echo The setup window will open now.
  echo.
  call "%~dp0Set-Firebase-Key.cmd"
  if not exist "config\firebase-admin.json" (
    echo No key was installed. MayMay was not started.
    pause
    exit /b 1
  )
)
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://maymay.local/'"
"%~dp0runtime\node.exe" scripts\host-terminal.mjs
if errorlevel 1 pause
