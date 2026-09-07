@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
"%ProgramFiles%\Git\cmd\git.exe" add -A > _temp\fix6.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Home stock columns: show only the warehouse head own flowers" >> _temp\fix6.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\fix6.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" log --oneline -1 >> _temp\fix6.txt 2>&1
exit
