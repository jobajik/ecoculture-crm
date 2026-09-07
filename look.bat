@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
call npx tsx scripts/show-stock.ts > _temp\look.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\look.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Add show-stock check script" >> _temp\look.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\look.txt 2>&1
exit
