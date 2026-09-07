@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== apex ==== > _temp\diag.txt
curl.exe -sI https://crm-ecoculture.kz/ >> _temp\diag.txt 2>&1
echo ==== www ==== >> _temp\diag.txt
curl.exe -sI https://www.crm-ecoculture.kz/ >> _temp\diag.txt 2>&1
echo ==== vercel.app ==== >> _temp\diag.txt
curl.exe -sI https://ecoculture-crm.vercel.app/ >> _temp\diag.txt 2>&1
echo ==== domains ==== >> _temp\diag.txt
call vercel domains ls >> _temp\diag.txt 2>&1
exit
