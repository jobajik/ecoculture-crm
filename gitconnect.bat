@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== git remote ==== > _temp\gitconnect.txt
call vercel git connect https://github.com/jobajik/ecoculture-crm --yes >> _temp\gitconnect.txt 2>&1
echo ==== project inspect ==== >> _temp\gitconnect.txt
call vercel project inspect ecoculture-crm >> _temp\gitconnect.txt 2>&1
exit
