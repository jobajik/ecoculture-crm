@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== npm ==== > _temp\check2.txt
call npm --version >> _temp\check2.txt 2>&1
echo ==== vercel cli ==== >> _temp\check2.txt
call vercel --version >> _temp\check2.txt 2>&1
echo ==== whoami ==== >> _temp\check2.txt
call vercel whoami >> _temp\check2.txt 2>&1
echo ==== link ==== >> _temp\check2.txt
type .vercel\project.json >> _temp\check2.txt 2>&1
echo ==== env var NAMES only ==== >> _temp\check2.txt
findstr /r /c:"^[A-Z_][A-Z_0-9]*=" .env.local > _temp\raw.txt 2>&1
for /f "tokens=1 delims==" %%A in (_temp\raw.txt) do echo %%A >> _temp\check2.txt
del /q _temp\raw.txt
exit
