@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== proverki ==== > _temp\ui3.txt
call npx tsx scripts/check-client-imports.ts >> _temp\ui3.txt 2>&1
call npx tsx scripts/check-stock-age.ts >> _temp\ui3.txt 2>&1
echo ==== github (Vercel soberet sam) ==== >> _temp\ui3.txt
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\ui3.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Stock detail: group by flower and variety, muted flower accents" >> _temp\ui3.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\ui3.txt 2>&1
echo ==== gotovo ==== >> _temp\ui3.txt
exit
