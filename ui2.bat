@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== proverki ==== > _temp\ui2.txt
call npx tsx scripts/check-client-imports.ts >> _temp\ui2.txt 2>&1
call npx tsx scripts/check-stock-age.ts >> _temp\ui2.txt 2>&1
echo ==== deploy ==== >> _temp\ui2.txt
call vercel deploy --prod --yes >> _temp\ui2.txt 2>&1
echo ==== github ==== >> _temp\ui2.txt
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\ui2.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Collapse long lists behind a show-more toggle" >> _temp\ui2.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\ui2.txt 2>&1
echo ==== gotovo ==== >> _temp\ui2.txt
exit
