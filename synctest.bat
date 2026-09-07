@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== status ==== > _temp\sync-test.txt
"%ProgramFiles%\Git\cmd\git.exe" status --short >> _temp\sync-test.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\sync-test.txt 2>&1
echo ==== commit ==== >> _temp\sync-test.txt
"%ProgramFiles%\Git\cmd\git.exe" commit -m "README: add production URL" >> _temp\sync-test.txt 2>&1
echo ==== push ==== >> _temp\sync-test.txt
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\sync-test.txt 2>&1
echo ==== last commit ==== >> _temp\sync-test.txt
"%ProgramFiles%\Git\cmd\git.exe" log --oneline -1 >> _temp\sync-test.txt 2>&1
exit
