@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== ochistka i zagruzka sklada ==== > _temp\load2.txt
call npx tsx scripts/reset-and-load.ts >> _temp\load2.txt 2>&1
echo ==== proverki ==== >> _temp\load2.txt
call npx tsx scripts/check-stock-age.ts >> _temp\load2.txt 2>&1
call npx tsx scripts/check-planning.ts >> _temp\load2.txt 2>&1
call npx tsx scripts/check-client-imports.ts >> _temp\load2.txt 2>&1
echo ==== deploy ==== >> _temp\load2.txt
call vercel deploy --prod --yes >> _temp\load2.txt 2>&1
echo ==== github ==== >> _temp\load2.txt
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\load2.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Real stock import: second-grade lengths, mini-mix varieties" >> _temp\load2.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\load2.txt 2>&1
echo ==== gotovo ==== >> _temp\load2.txt
exit
