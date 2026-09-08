@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== probnaya rezervnaya kopiya ==== > _temp\backup.txt
call npx tsx scripts/backup-now.ts >> _temp\backup.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\backup.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Add manual backup runner" >> _temp\backup.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\backup.txt 2>&1
exit
