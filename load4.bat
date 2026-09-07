@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== check-sheet-date ==== > _temp\load4.txt
call npx tsx scripts/check-sheet-date.ts >> _temp\load4.txt 2>&1
echo ==== perezagruzka sklada ==== >> _temp\load4.txt
call npx tsx scripts/reset-and-load.ts >> _temp\load4.txt 2>&1
echo ==== chto vidno na sayte ==== >> _temp\load4.txt
call npx tsx scripts/show-stock.ts >> _temp\load4.txt 2>&1
echo ==== deploy ==== >> _temp\load4.txt
call vercel deploy --prod --yes >> _temp\load4.txt 2>&1
echo ==== github ==== >> _temp\load4.txt
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\load4.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Normalize sheet dates on read; delete rows when clearing a tab" >> _temp\load4.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\load4.txt 2>&1
echo ==== gotovo ==== >> _temp\load4.txt
exit
