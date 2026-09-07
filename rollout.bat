@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== setup-sheet (Orders got new columns) ==== > _temp\rollout.txt
call npm run setup-sheet >> _temp\rollout.txt 2>&1
echo ==== git push ==== >> _temp\rollout.txt
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\rollout.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Accountant role: payments, debts, period report, two-check readiness" >> _temp\rollout.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\rollout.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" log --oneline -2 >> _temp\rollout.txt 2>&1
exit
