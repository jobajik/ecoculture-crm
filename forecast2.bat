@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== udalyaem staryy ForecastGrid ==== > _temp\forecast2.txt
if exist src\components\ForecastGrid.tsx del /f /q src\components\ForecastGrid.tsx
if exist src\components\ForecastGrid.tsx (echo NE UDALEN >> _temp\forecast2.txt) else (echo udalen ili ego ne bylo >> _temp\forecast2.txt)
echo ==== check-planning ==== >> _temp\forecast2.txt
call npx tsx scripts/check-planning.ts >> _temp\forecast2.txt 2>&1
echo ==== check-balance ==== >> _temp\forecast2.txt
call npx tsx scripts/check-balance.ts >> _temp\forecast2.txt 2>&1
echo ==== check-weeks ==== >> _temp\forecast2.txt
call npx tsx scripts/check-weeks.ts >> _temp\forecast2.txt 2>&1
echo ==== check-forecast-excel ==== >> _temp\forecast2.txt
call npx tsx scripts/check-forecast-excel.ts >> _temp\forecast2.txt 2>&1
echo ==== check-client-imports ==== >> _temp\forecast2.txt
call npx tsx scripts/check-client-imports.ts >> _temp\forecast2.txt 2>&1
echo ==== setup-sheet (sozdaet vkladku HarvestMix) ==== >> _temp\forecast2.txt
call npm run setup-sheet >> _temp\forecast2.txt 2>&1
echo ==== set NEXTAUTH_URL ==== >> _temp\forecast2.txt
call node set-url.mjs >> _temp\forecast2.txt 2>&1
echo ==== deploy ==== >> _temp\forecast2.txt
call vercel deploy --prod --yes >> _temp\forecast2.txt 2>&1
echo ==== gotovo ==== >> _temp\forecast2.txt
exit
