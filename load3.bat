@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== ochistka i zagruzka sklada ==== > _temp\load3.txt
call npx tsx scripts/reset-and-load.ts >> _temp\load3.txt 2>&1
echo ==== github ==== >> _temp\load3.txt
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\load3.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Stock import script: load env before Sheets access" >> _temp\load3.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\load3.txt 2>&1
echo ==== gotovo ==== >> _temp\load3.txt
exit
