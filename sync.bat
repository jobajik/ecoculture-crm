@echo off
chcp 65001 >nul
title Отправка на GitHub
cd /d "%~dp0"
if not exist _temp mkdir _temp
(
echo ==== changes ====
"%ProgramFiles%\Git\cmd\git.exe" status --short
"%ProgramFiles%\Git\cmd\git.exe" add -A
echo ==== commit ====
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Update from Ecoculture-CRM"
echo ==== push ====
"%ProgramFiles%\Git\cmd\git.exe" push
echo ==== last commits ====
"%ProgramFiles%\Git\cmd\git.exe" log --oneline -3
) > _temp\sync-log.txt 2>&1
type _temp\sync-log.txt
echo.
echo   Готово: https://github.com/jobajik/ecoculture-crm
timeout /t 5 >nul
exit
