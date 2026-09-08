@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== zagruzka: + srez hrizy 07.09 ==== > _temp\load7.txt
call npx tsx scripts/reset-and-load.ts --force >> _temp\load7.txt 2>&1
echo ==== chto vidno na sayte ==== >> _temp\load7.txt
call npx tsx scripts/show-stock.ts >> _temp\load7.txt 2>&1
echo ==== deploy ==== >> _temp\load7.txt
call vercel deploy --prod --yes >> _temp\load7.txt 2>&1
echo ==== github ==== >> _temp\load7.txt
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\load7.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Chrysanthemum cut for 07.09; Brak grade; guard against wiping live data" >> _temp\load7.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\load7.txt 2>&1
echo ==== gotovo ==== >> _temp\load7.txt
exit
