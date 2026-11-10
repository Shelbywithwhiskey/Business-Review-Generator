# One-time setup for the move to Supabase + the new Vercel project.
# Reads C:\Users\sharanraajbabu\supabase.txt (KEY=value lines), creates the tables in the new
# Supabase database, and stores every setting in the linked Vercel project (Production).
# Prints setting NAMES only, never values. Run from the repo root after `vercel link`.
param([string]$SecretsFile = "C:\Users\sharanraajbabu\supabase.txt")
$ErrorActionPreference = "Stop"

if (-not (Test-Path $SecretsFile)) { throw "Not found: $SecretsFile" }
$s = @{}
foreach ($line in Get-Content $SecretsFile) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') { $s[$Matches[1]] = $Matches[2].Trim('"', "'") }
}
if (-not $s.DATABASE_URL -and $s.TRANSACTION) { $s.DATABASE_URL = $s.TRANSACTION }
if (-not $s.DIRECT_URL -and $s.SESSION) { $s.DIRECT_URL = $s.SESSION }

foreach ($k in "DATABASE_URL", "DIRECT_URL", "APP_PASSWORD") {
  if (-not $s[$k]) { throw "$k is missing from $SecretsFile" }
}
foreach ($k in "DATABASE_URL", "DIRECT_URL") {
  if ($s[$k] -match '\[YOUR-PASSWORD\]') { throw "$k still contains [YOUR-PASSWORD] - put the database password in." }
  try { $u = [Uri]$s[$k] } catch { throw "$k is not a valid URL. If the password has symbols like @ # / ? %, reset it to letters and numbers only." }
}
if (([Uri]$s.DATABASE_URL).Port -ne 6543) { throw "DATABASE_URL should be the transaction pooler (port 6543)." }
if (([Uri]$s.DIRECT_URL).Port -ne 5432) { throw "DIRECT_URL should be the session pooler (port 5432)." }

function New-Secret { -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) }) }

Write-Host "1/2 Creating tables in Supabase..." -ForegroundColor Cyan
$env:DATABASE_URL = $s.DATABASE_URL
$env:DIRECT_URL = $s.DIRECT_URL
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed (see above)." }

Write-Host "2/2 Saving settings in Vercel (Production)..." -ForegroundColor Cyan
$vars = [ordered]@{
  DATABASE_URL       = $s.DATABASE_URL
  DIRECT_URL         = $s.DIRECT_URL
  APP_PASSWORD       = $s.APP_PASSWORD
  AUTH_SECRET        = New-Secret
  CRON_SECRET        = New-Secret
  ZUPER_API_BASE_URL = "https://us-east-1.zuperpro.com/api"
}
if ($s.GEMINI_API_KEY) { $vars.GEMINI_API_KEY = $s.GEMINI_API_KEY }
foreach ($name in $vars.Keys) {
  npx vercel env add $name production --value $vars[$name] --yes --force *> $null
  if ($LASTEXITCODE -ne 0) { throw "Could not save $name in Vercel. Is this folder linked (npx vercel link)?" }
  Write-Host "  saved $name"
}
Remove-Item Env:DATABASE_URL, Env:DIRECT_URL
Write-Host "Done. Nothing secret was printed." -ForegroundColor Green
