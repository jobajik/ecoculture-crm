@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== proverki ==== > _temp\mob.txt
call npx tsx scripts/check-client-imports.ts >> _temp\mob.txt 2>&1
echo ==== github (Vercel soberet sam) ==== >> _temp\mob.txt
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\mob.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Mobile: bottom navigation, bigger tap targets, two-line stock rows" >> _temp\mob.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\mob.txt 2>&1
echo ==== gotovo ==== >> _temp\mob.txt
exit
