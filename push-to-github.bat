@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
move /y _claude-check.txt _temp\ >nul 2>&1
move /y _claude-install.txt _temp\ >nul 2>&1
move /y _claude-install2.txt _temp\ >nul 2>&1
move /y _claude-auth.txt _temp\ >nul 2>&1
move /y check.bat _temp\ >nul 2>&1
move /y install-git.bat _temp\ >nul 2>&1
move /y install-gh.bat _temp\ >nul 2>&1
move /y login-github.bat _temp\ >nul 2>&1
(
echo ==== init ====
"%ProgramFiles%\Git\cmd\git.exe" init -b main
"%ProgramFiles%\Git\cmd\git.exe" config user.name "Yerzhan Sadakbayev"
"%ProgramFiles%\Git\cmd\git.exe" config user.email "y.sadakbayev@gmail.com"
echo ==== staged files count ====
"%ProgramFiles%\Git\cmd\git.exe" add -A
"%ProgramFiles%\Git\cmd\git.exe" diff --cached --name-only | find /c /v ""
echo ==== secrets guard ====
"%ProgramFiles%\Git\cmd\git.exe" diff --cached --name-only | findstr /i ".env.local"
echo ==== commit ====
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Initial commit: Ecoculture-CRM"
echo ==== create repo and push ====
"%ProgramFiles%\GitHub CLI\gh.exe" repo create ecoculture-crm --public --source=. --remote=origin --push --description "Ecoculture-CRM: greenhouse flower order intake, warehouse and sales analytics (Next.js + Google Sheets)"
echo ==== result ====
"%ProgramFiles%\GitHub CLI\gh.exe" repo view --json url,visibility,isPrivate,name
"%ProgramFiles%\Git\cmd\git.exe" log --oneline -1
) > _claude-push.txt 2>&1
exit
