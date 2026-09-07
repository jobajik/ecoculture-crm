@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== installing vercel cli ==== > _temp\vercel-install.txt
call npm install -g vercel@latest >> _temp\vercel-install.txt 2>&1
echo ==== version ==== >> _temp\vercel-install.txt
call vercel --version >> _temp\vercel-install.txt 2>&1
exit
