@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== proverki ==== > _temp\ship.txt
call npx tsx scripts/check-client-imports.ts >> _temp\ship.txt 2>&1
call npx tsx scripts/check-isolation.ts >> _temp\ship.txt 2>&1
echo ==== github ==== >> _temp\ship.txt
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\ship.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Batch picking: readable chooser, quiet batch codes" >> _temp\ship.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\ship.txt 2>&1
echo ==== gotovo ==== >> _temp\ship.txt
exit
