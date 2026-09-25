# Writes one secret into .env.local without showing it anywhere.
# The value is typed (pasted) by the owner into a hidden prompt; only its length is printed.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\set-env-secret.ps1 NAME "Prompt text"
param([Parameter(Mandatory=$true)][string]$Name, [string]$Label = $Name)

$sec = Read-Host -AsSecureString $Label
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$plain = ("" + $plain).Trim()
if (-not $plain) { Write-Host "  pusto - $Name ne menyayu"; exit 0 }

$path = Join-Path (Get-Location) ".env.local"
$lines = @()
if (Test-Path $path) {
  $lines = @(Get-Content -LiteralPath $path -Encoding UTF8 | Where-Object { $_ -notmatch ("^\s*" + [regex]::Escape($Name) + "\s*=") })
}
$lines += ($Name + "=" + $plain)
[IO.File]::WriteAllLines($path, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
Write-Host ("  " + $Name + " zapisan (" + $plain.Length + " simv.)")
