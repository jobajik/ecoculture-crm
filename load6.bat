@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== zagruzka sklada (rozy + eustoma + hriza) ==== > _temp\load6.txt
call npx tsx scripts/reset-and-load.ts >> _temp\load6.txt 2>&1
echo ==== chto vidno na sayte ==== >> _temp\load6.txt
call npx tsx scripts/show-stock.ts >> _temp\load6.txt 2>&1
echo ==== deploy ==== >> _temp\load6.txt
call vercel deploy --prod --yes >> _temp\load6.txt 2>&1
echo ==== github ==== >> _temp\load6.txt
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\load6.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Load chrysanthemum stock; seed default varieties" >> _temp\load6.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\load6.txt 2>&1
echo ==== gotovo ==== >> _temp\load6.txt
exit
