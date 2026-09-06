@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   Ecoculture-CRM запускается...
echo   Когда ниже появится "Ready", откройте в браузере:  http://localhost:3000
echo   Чтобы остановить - просто закройте это окно.
echo.
call npm run dev
echo.
echo   Сервер остановлен. Нажмите любую клавишу, чтобы закрыть окно.
pause >nul
