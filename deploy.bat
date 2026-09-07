@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== whoami ==== > _temp\deploy.txt
call vercel whoami >> _temp\deploy.txt 2>&1
echo ==== link project ==== >> _temp\deploy.txt
call vercel link --yes --project ecoculture-crm >> _temp\deploy.txt 2>&1
echo ==== connect github repo ==== >> _temp\deploy.txt
call vercel git connect --yes >> _temp\deploy.txt 2>&1
echo ==== env vars (values never printed) ==== >> _temp\deploy.txt
call node env-push.mjs >> _temp\deploy.txt 2>&1
echo ==== deploy ==== >> _temp\deploy.txt
call vercel deploy --prod --yes >> _temp\deploy.txt 2>&1
echo ==== inspect ==== >> _temp\deploy.txt
call vercel project ls >> _temp\deploy.txt 2>&1
exit
