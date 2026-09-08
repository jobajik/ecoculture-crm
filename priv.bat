@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== github (Vercel soberet sam) ==== > _temp\priv.txt
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\priv.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Public privacy policy page (required to publish the Google app)" >> _temp\priv.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\priv.txt 2>&1
echo ==== gotovo ==== >> _temp\priv.txt
exit
