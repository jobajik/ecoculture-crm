@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== drop helper scripts from repo ==== > _temp\tidy.txt
"%ProgramFiles%\Git\cmd\git.exe" rm --cached check2.bat >> _temp\tidy.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" rm --cached cleanup.bat >> _temp\tidy.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" rm --cached deploy.bat >> _temp\tidy.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" rm --cached deploy2.bat >> _temp\tidy.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" rm --cached gitconnect.bat >> _temp\tidy.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" rm --cached install-vercel.bat >> _temp\tidy.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" rm --cached login-vercel.bat >> _temp\tidy.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" rm --cached synctest.bat >> _temp\tidy.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" rm --cached verify.bat >> _temp\tidy.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" rm --cached env-push.mjs >> _temp\tidy.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" rm --cached set-url.mjs >> _temp\tidy.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\tidy.txt 2>&1
echo ==== commit ==== >> _temp\tidy.txt
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Keep one-time setup scripts out of the repo" >> _temp\tidy.txt 2>&1
echo ==== push ==== >> _temp\tidy.txt
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\tidy.txt 2>&1
echo ==== tracked count ==== >> _temp\tidy.txt
"%ProgramFiles%\Git\cmd\git.exe" ls-files | find /c /v "" >> _temp\tidy.txt 2>&1
exit
