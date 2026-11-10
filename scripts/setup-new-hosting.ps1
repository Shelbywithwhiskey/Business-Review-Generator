# One-time setup for Business Review Generator on Supabase + its Vercel project.
# Asks for the Supabase password (and the login password, if the file has none) in a popup.
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
# Small popup with a hidden-text box, so no secret has to be typed into a file or the chat.
function Read-SecretPopup([string]$Title, [string]$Prompt) {
  Add-Type -AssemblyName System.Windows.Forms
  $form = New-Object Windows.Forms.Form -Property @{ Text = $Title; Width = 460; Height = 170; StartPosition = "CenterScreen"; TopMost = $true; FormBorderStyle = "FixedDialog"; MaximizeBox = $false; MinimizeBox = $false }
  $label = New-Object Windows.Forms.Label -Property @{ Text = $Prompt; Left = 12; Top = 12; Width = 420; Height = 20 }
  $box = New-Object Windows.Forms.TextBox -Property @{ Left = 12; Top = 38; Width = 420; UseSystemPasswordChar = $true }
  $ok = New-Object Windows.Forms.Button -Property @{ Text = "OK"; Left = 352; Top = 72; Width = 80; DialogResult = "OK" }
  $form.Controls.AddRange(@($label, $box, $ok)); $form.AcceptButton = $ok
  if ($form.ShowDialog() -ne "OK" -or -not $box.Text) { throw "$Title was cancelled." }
  return $box.Text
}
if (-not $s.SUPABASE_PASSWORD -and $s.DATABASE_URL -match '\[YOUR-PASSWORD\]') {
  $s.SUPABASE_PASSWORD = Read-SecretPopup "Supabase password" "Type your Supabase database password, then click OK."
}
if (-not $s.APP_PASSWORD) {
  $s.APP_PASSWORD = Read-SecretPopup "Tool login password" "Choose the password for logging in to Business Review Generator."
}
# The database password may be given on its own line instead of inside both URLs.
if ($s.SUPABASE_PASSWORD) {
  $enc = [Uri]::EscapeDataString($s.SUPABASE_PASSWORD)
  foreach ($k in "DATABASE_URL", "DIRECT_URL") { if ($s[$k]) { $s[$k] = $s[$k].Replace("[YOUR-PASSWORD]", $enc) } }
}

foreach ($k in "DATABASE_URL", "DIRECT_URL", "APP_PASSWORD") {
  if (-not $s[$k]) { throw "$k is missing from $SecretsFile" }
}
foreach ($k in "DATABASE_URL", "DIRECT_URL") {
  if ($s[$k] -match '\[YOUR-PASSWORD\]') { throw "$k still contains [YOUR-PASSWORD] - put the database password in." }
  try { $u = [Uri]$s[$k] } catch { throw "$k is not a valid URL. If the password has symbols like @ # / ? %, reset it to letters and numbers only." }
}
# Supabase's pooler can take longer than Prisma's 5s default to accept the first connection.
foreach ($k in "DATABASE_URL", "DIRECT_URL") {
  if ($s[$k] -notmatch 'connect_timeout=') { $s[$k] += $(if ($s[$k].Contains("?")) { "&" } else { "?" }) + "connect_timeout=30" }
  if ($s[$k] -notmatch 'sslmode=') { $s[$k] += "&sslmode=require" }
}
if (([Uri]$s.DATABASE_URL).Port -ne 6543) { throw "DATABASE_URL should be the transaction pooler (port 6543)." }
if (([Uri]$s.DIRECT_URL).Port -ne 5432) { throw "DIRECT_URL should be the session pooler (port 5432)." }

function New-Secret {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

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
  # Call the CLI through node, not npx: npx is a .cmd file, and cmd.exe splits values at "&".
  node .\node_modules\vercel\dist\index.js env add $name production --value $vars[$name] --yes --force *> $null
  if ($LASTEXITCODE -ne 0) { throw "Could not save $name in Vercel. Is this folder linked (npx vercel link)?" }
  Write-Host "  saved $name"
}
Remove-Item Env:DATABASE_URL, Env:DIRECT_URL
Write-Host "Done. Nothing secret was printed." -ForegroundColor Green
