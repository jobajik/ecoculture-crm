@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist _temp mkdir _temp
echo ==== 1. sekret dlya nochnoy kopii ==== > _temp\final.txt
node -e "const fs=require('fs');const f='.env.local';let t=fs.readFileSync(f,'utf8');if(/^CRON_SECRET=/m.test(t)){console.log('CRON_SECRET uzhe est');}else{const s=require('crypto').randomBytes(24).toString('hex');fs.writeFileSync(f,t.replace(/\s*$/,'')+'\nCRON_SECRET='+s+'\n');console.log('CRON_SECRET sozdan, dlina '+s.length);}" >> _temp\final.txt 2>&1
call node env-push.mjs >> _temp\final.txt 2>&1

echo ==== 2. proverki ==== >> _temp\final.txt
call npx tsx scripts/check-prices.ts >> _temp\final.txt 2>&1
call npx tsx scripts/check-client-imports.ts >> _temp\final.txt 2>&1

echo ==== 3. ubirayu lishnie bat ==== >> _temp\final.txt
for %%f in (load2 load3 load4 load5 load6 load7 ui2 ui3 mob peek look stock2 forecast2 push2 push3 push4 fix5 fix6 navfix rollout tidy synctest verify gitconnect check2 cleanup deploy install-vercel setup2 priv push-to-github logs) do (
  if exist %%f.bat ( del /f /q %%f.bat & echo udalen %%f.bat >> _temp\final.txt )
)
echo ostavleny: sync, start-crm, diag, deploy2, login-vercel, token, check, final >> _temp\final.txt

echo ==== 4. github ==== >> _temp\final.txt
"%ProgramFiles%\Git\cmd\git.exe" add -A >> _temp\final.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" commit -m "Price list, nightly backup, cleanup of one-off scripts" >> _temp\final.txt 2>&1
"%ProgramFiles%\Git\cmd\git.exe" push >> _temp\final.txt 2>&1
echo ==== gotovo ==== >> _temp\final.txt
exit
