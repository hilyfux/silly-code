$ErrorActionPreference = 'Continue'

$installDir = if ($env:SILLY_CODE_HOME) { $env:SILLY_CODE_HOME } else { Join-Path $HOME '.local\share\silly-code' }
$binDir = Join-Path $HOME '.local\bin'
$dataDir = if ($env:SILLY_CODE_DATA) { $env:SILLY_CODE_DATA } else { Join-Path $HOME '.silly-code' }

function Info($msg) { Write-Host "[silly] $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "[silly] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[silly] $msg" -ForegroundColor Yellow }

Write-Host ''
Write-Host '  silly-code uninstaller' -ForegroundColor Cyan
Write-Host ''

$removed = 0

if (Test-Path $installDir) {
  Info "Removing source: $installDir"
  Remove-Item -Recurse -Force $installDir -ErrorAction SilentlyContinue
  if (-not (Test-Path $installDir)) { Ok "Removed $installDir"; $removed++ }
}

$cmdNames = @('silly','sillyx','sillye','sillyxs','sillyes')
foreach ($cmd in $cmdNames) {
  foreach ($ext in @('.cmd','.ps1')) {
    $path = Join-Path $binDir ($cmd + $ext)
    if (Test-Path $path) {
      Remove-Item -Force $path -ErrorAction SilentlyContinue
      if (-not (Test-Path $path)) { Ok "Removed $path"; $removed++ }
    }
  }
}

if (Test-Path $dataDir) {
  $confirm = Read-Host "  Remove saved tokens in $dataDir? [y/N]"
  if ($confirm -match '^[Yy]$') {
    Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue
    if (-not (Test-Path $dataDir)) { Ok "Removed tokens: $dataDir"; $removed++ }
  } else {
    Info "Kept tokens: $dataDir"
  }
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath) {
  $normalizedBinDir = ($binDir -replace '/','\').TrimEnd('\')
  $filteredEntries = @()
  foreach ($entry in ($userPath -split ';')) {
    $normalized = ($entry -replace '/','\').TrimEnd('\')
    if ($normalized -ne $normalizedBinDir -and $entry.Length -gt 0) {
      $filteredEntries += $entry
    }
  }
  $newUserPath = ($filteredEntries -join ';')
  if ($newUserPath -ne $userPath) {
    [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
    Ok "Removed $binDir from user PATH"
    $removed++
  }
}

Write-Host ''
if ($removed -eq 0) {
  Info 'Nothing found to remove. silly-code may not be installed.'
} else {
  Ok "Uninstall complete. Removed $removed item(s)."
  Warn 'Open a NEW PowerShell or cmd window so the refreshed PATH is picked up.'
}
Write-Host ''
