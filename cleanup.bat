@echo off
chcp 65001 >nul
cd /d "%~dp0"
(
"%ProgramFiles%\Git\cmd\git.exe" rm --cached push-to-github.bat
"%ProgramFiles%\Git\cmd\git.exe" add -A
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Add sync.bat, drop one-time setup script"
"%ProgramFiles%\Git\cmd\git.exe" push
echo ==== tracked files ====
"%ProgramFiles%\Git\cmd\git.exe" ls-files | find /c /v ""
"%ProgramFiles%\Git\cmd\git.exe" log --oneline -3
) > _temp\cleanup-log.txt 2>&1
exit
