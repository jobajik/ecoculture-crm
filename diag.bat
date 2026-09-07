@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== DNS apex ==== > _temp\diag.txt
nslookup crm-ecoculture.kz 8.8.8.8 >> _temp\diag.txt 2>&1
echo ==== DNS www ==== >> _temp\diag.txt
nslookup www.crm-ecoculture.kz 8.8.8.8 >> _temp\diag.txt 2>&1
echo ==== http apex ==== >> _temp\diag.txt
curl.exe -sI http://crm-ecoculture.kz/analytics >> _temp\diag.txt 2>&1
echo ==== http www ==== >> _temp\diag.txt
curl.exe -sI http://www.crm-ecoculture.kz/ >> _temp\diag.txt 2>&1
echo ==== https apex ==== >> _temp\diag.txt
curl.exe -sI https://crm-ecoculture.kz/ >> _temp\diag.txt 2>&1
echo ==== https www ==== >> _temp\diag.txt
curl.exe -sI https://www.crm-ecoculture.kz/ >> _temp\diag.txt 2>&1
exit
