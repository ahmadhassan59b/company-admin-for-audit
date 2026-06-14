$ErrorActionPreference = "Stop"

function Get-ListeningPid($port) {
  $lines = cmd /c "netstat -ano | findstr :$port" 2>$null
  if (-not $lines) { return $null }
  foreach ($line in $lines) {
    if ($line -match "LISTENING\s+(\d+)\s*$") {
      return [int]$Matches[1]
    }
  }
  return $null
}

$backendPid = Get-ListeningPid 3000
if ($backendPid) {
  try { Stop-Process -Id $backendPid -Force } catch {}
  Start-Sleep -Milliseconds 400
}

$proc = Start-Process -FilePath node -ArgumentList "src/server.js" -WorkingDirectory (Resolve-Path ".") -PassThru -WindowStyle Hidden

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:3000/health" -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
  Start-Sleep -Milliseconds 300
}

if (-not $ready) {
  try { Stop-Process -Id $proc.Id -Force } catch {}
  throw "Backend did not become ready on port 3000"
}

try {
  $audit = curl.exe -s -X POST "http://127.0.0.1:3000/api/audit/run?ai=true" -H "Content-Type: application/json" -d "{}"
  Write-Output $audit
} finally {
  try { Stop-Process -Id $proc.Id -Force } catch {}
}

