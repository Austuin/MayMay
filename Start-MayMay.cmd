@echo off
color 0B
title MayMay Host
cd /d "%~dp0"
npm run host
if errorlevel 1 pause
