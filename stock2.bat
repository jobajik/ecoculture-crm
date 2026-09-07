@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== check-stock-age ==== > _temp\stock2.txt
call npx tsx scripts/check-stock-age.ts >> _temp\stock2.txt 2>&1
echo ==== check-farms ==== >> _temp\stock2.txt
call npx tsx scripts/check-farms.ts >> _temp\stock2.txt 2>&1
echo ==== check-isolation ==== >> _temp\stock2.txt
call npx tsx scripts/check-isolation.ts >> _temp\stock2.txt 2>&1
echo ==== check-client-imports ==== >> _temp\stock2.txt
call npx tsx scripts/check-client-imports.ts >> _temp\stock2.txt 2>&1
echo ==== deploy ==== >> _temp\stock2.txt
call vercel deploy --prod --yes >> _temp\stock2.txt 2>&1
echo ==== github ==== >> _temp\stock2.txt
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\stock2.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Stock age ranges on the home page" >> _temp\stock2.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\stock2.txt 2>&1
echo ==== gotovo ==== >> _temp\stock2.txt
exit
