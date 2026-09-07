@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== set NEXTAUTH_URL ==== > _temp\deploy2.txt
call node set-url.mjs >> _temp\deploy2.txt 2>&1
echo ==== redeploy ==== >> _temp\deploy2.txt
call vercel deploy --prod --yes >> _temp\deploy2.txt 2>&1
exit
