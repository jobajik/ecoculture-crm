@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== perevypusk tokena ==== > _temp\token.txt
call npx tsx scripts/renew-token.ts >> _temp\token.txt 2>&1
echo ==== otpravlyayu na Vercel ==== >> _temp\token.txt
call node env-push.mjs >> _temp\token.txt 2>&1
echo ==== gotovo ==== >> _temp\token.txt
exit
