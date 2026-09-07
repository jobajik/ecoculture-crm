@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
call npx tsx scripts/peek-dates.ts > _temp\peek.txt 2>&1
exit
