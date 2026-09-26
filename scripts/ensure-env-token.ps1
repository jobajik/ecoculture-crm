# Adds NAME=<random token> to .env.local if NAME is not there yet. Never prints the value.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ensure-env-token.ps1 NAME
param([Parameter(Mandatory=$true)][string]$Name)
$path = Join-Path (Get-Location) ".env.local"
$lines = @()
if (Test-Path $path) { $lines = @(Get-Content -LiteralPath $path -Encoding UTF8) }
if ($lines | Where-Object { $_ -match ("^\s*" + [regex]::Escape($Name) + "\s*=\s*\S") }) { Write-Host "  $Name uzhe est"; exit 0 }
$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
$lines = @($lines | Where-Object { $_ -notmatch ("^\s*" + [regex]::Escape($Name) + "\s*=") })
$lines += ($Name + "=" + $token)
[IO.File]::WriteAllLines($path, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
Write-Host ("  " + $Name + " sozdan (" + $token.Length + " simv.)")
