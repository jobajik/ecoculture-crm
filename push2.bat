@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
"%ProgramFiles%\Git\cmd\git.exe" add -A > _temp\push2.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Leaderboard with bonuses, slimmer navigation, Kaspi/cash payments" >> _temp\push2.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\push2.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" log --oneline -1 >> _temp\push2.txt 2>&1
exit
