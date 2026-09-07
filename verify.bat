@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== project inspect ==== > _temp\verify.txt
call vercel project inspect ecoculture-crm >> _temp\verify.txt 2>&1
echo ==== deployments BEFORE ==== >> _temp\verify.txt
call vercel ls ecoculture-crm >> _temp\verify.txt 2>&1
exit
