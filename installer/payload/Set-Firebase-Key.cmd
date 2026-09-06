@echo off
color 0B
title Set up MayMay Firebase key
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Set-Firebase-Key.ps1"
if errorlevel 1 pause
