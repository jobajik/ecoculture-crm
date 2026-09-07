@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== logs ==== > _temp\logs.txt
call vercel logs https://www.crm-ecoculture.kz --json >> _temp\logs.txt 2>&1
exit
