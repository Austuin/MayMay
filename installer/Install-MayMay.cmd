@echo off
color 0B
title MayMay Offline Installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-MayMay.ps1"
if errorlevel 1 pause
