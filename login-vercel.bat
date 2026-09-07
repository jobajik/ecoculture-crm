@echo off
chcp 65001 >nul
title Вход в Vercel
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo.
echo   ====== ВХОД В VERCEL ======
echo.
echo   Сейчас откроется браузер.
echo   Нажмите там кнопку подтверждения входа - и всё.
echo.
call vercel login --github
echo.
call vercel whoami > _temp\vercel-who.txt 2>&1
type _temp\vercel-who.txt
echo.
echo   Готово. Можно закрыть окно.
pause
