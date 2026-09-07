@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== proverki ==== > _temp\setup2.txt
call npx tsx scripts/check-planning.ts >> _temp\setup2.txt 2>&1
echo ==== izolyaciya ==== >> _temp\setup2.txt
call npx tsx scripts/check-isolation.ts >> _temp\setup2.txt 2>&1
echo ==== setup-sheet ==== >> _temp\setup2.txt
call npm run setup-sheet >> _temp\setup2.txt 2>&1
exit
