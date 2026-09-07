@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
"%ProgramFiles%\Git\cmd\git.exe" add -A > _temp\fix5.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Scope orders list, order detail and analytics by farm" >> _temp\fix5.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\fix5.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" log --oneline -1 >> _temp\fix5.txt 2>&1
exit
