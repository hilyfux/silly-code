$ErrorActionPreference = 'Stop'

# Force TLS 1.2 (and 1.3 if available). PowerShell 5.x on Windows defaults to
# TLS 1.0/1.1 which GitHub rejects with "基础连接已经关闭: 发送时发生错误"
# (the underlying connection was closed: an error occurred on a send). Must
# run BEFORE any Invoke-WebRequest. Bitwise-OR so we don't downgrade callers
# that already enabled stronger protocols.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor `
    [Net.SecurityProtocolType]::Tls12
  if ([Enum]::IsDefined([Net.SecurityProtocolType], 'Tls13')) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor `
      [Net.SecurityProtocolType]::Tls13
  }
} catch {}

$installDir = if ($env:SILLY_CODE_HOME) { $env:SILLY_CODE_HOME } else { Join-Path $HOME '.local\share\silly-code' }
$binDir     = Join-Path $HOME '.local\bin'
$dataDir    = if ($env:SILLY_CODE_DATA) { $env:SILLY_CODE_DATA } else { Join-Path $HOME '.silly-code' }
$downloadUrl = 'https://github.com/hilyfux/silly-code/releases/latest/download/silly-code.tar.gz'

function Info($msg) { Write-Host "[silly] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[silly] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[silly] $msg" -ForegroundColor Yellow }
function Fail($msg) { throw "[silly] $msg" }

Write-Host ''
Write-Host '  silly-code installer' -ForegroundColor Cyan
Write-Host ''

# ── Prerequisites ───────────────────────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js >= 20 is required. Install it first: https://nodejs.org'
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
  Fail "Node.js >= 20 required (found $(node --version))."
}
Ok "Node: $(node --version)"

# ── ripgrep ─────────────────────────────────────────────────────────────────
$rgBin = $null
if (Get-Command rg -ErrorAction SilentlyContinue) {
  $rgBin = (Get-Command rg).Source
  Ok "ripgrep: $((rg --version | Select-Object -First 1))"
} elseif (Test-Path (Join-Path $binDir 'rg.exe')) {
  $rgBin = Join-Path $binDir 'rg.exe'
  Ok "ripgrep: $rgBin"
} else {
  $rgVersion = '14.1.1'
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64' } else { 'x86_64' }
  $rgAsset = "ripgrep-$rgVersion-$arch-pc-windows-msvc"
  $rgUrl = "https://github.com/BurntSushi/ripgrep/releases/download/$rgVersion/$rgAsset.zip"
  Info "Installing ripgrep $rgVersion..."
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    $zipPath = Join-Path $tmp 'rg.zip'
    Invoke-WebRequest -Uri $rgUrl -OutFile $zipPath -UseBasicParsing
    Expand-Archive -Path $zipPath -DestinationPath $tmp -Force
    $rgExe = Get-ChildItem -Path $tmp -Recurse -Filter 'rg.exe' | Select-Object -First 1
    if ($rgExe) {
      New-Item -ItemType Directory -Force -Path $binDir | Out-Null
      Copy-Item $rgExe.FullName (Join-Path $binDir 'rg.exe') -Force
      $rgBin = Join-Path $binDir 'rg.exe'
      Ok "ripgrep $rgVersion installed"
    } else {
      Warn 'rg.exe not found in archive — file search will be slow.'
    }
  } catch {
    Warn "Failed to download ripgrep: $($_.Exception.Message). File search will be slow."
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

# ── Download tarball ─────────────────────────────────────────────────────────
# Two-strategy download: Invoke-WebRequest first (works on most setups);
# curl.exe fallback (ships in Windows 10 1803+, handles TLS / proxy / redirect
# cases that .NET WebRequest still mangles in 2026). If both fail, we surface
# the original PowerShell error AND tell the user how to download manually.
Info 'Downloading silly-code...'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  $tgz = Join-Path $tmp 'silly-code.tar.gz'
  $iwrErr = $null
  try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tgz -UseBasicParsing
  } catch {
    $iwrErr = $_.Exception.Message
    Warn "Invoke-WebRequest failed ($iwrErr). Trying curl.exe fallback..."
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
      $curlOut = & curl.exe -fsSL --retry 3 --retry-delay 2 -o $tgz $downloadUrl 2>&1
      if ($LASTEXITCODE -ne 0) {
        Fail "Download failed via both Invoke-WebRequest and curl.exe.`n  IWR error : $iwrErr`n  curl error: $curlOut`n  Manual: download $downloadUrl in a browser, then re-run with `$env:SILLY_CODE_TARBALL=<path>`."
      }
      Ok 'Downloaded via curl.exe fallback'
    } else {
      Fail "Download failed: $iwrErr.`n  curl.exe not present (Windows 10 1803+ ships it). Manual: download $downloadUrl in a browser."
    }
  }

  # ── Extract ───────────────────────────────────────────────────────────────
  # Extract into $tmp first (no path issues), then Copy-Item to final location.
  Info 'Extracting...'
  tar -xzf $tgz -C $tmp
  $extracted = Join-Path $tmp 'silly-code'
  if (-not (Test-Path $extracted)) {
    Fail 'Extraction failed — silly-code folder not found in archive.'
  }

  # Remove old install if it looks safe to replace
  if (Test-Path $installDir) {
    $isSillyInstall = (Test-Path (Join-Path $installDir 'versions')) -or
                      (Test-Path (Join-Path $installDir 'deps.json')) -or
                      (Test-Path (Join-Path $installDir 'bin\silly')) -or
                      ((Get-ChildItem $installDir -Force | Measure-Object).Count -eq 0)
    if ($isSillyInstall) {
      Remove-Item -Recurse -Force $installDir
    } else {
      Fail "$installDir exists and is not a silly-code install. Remove it manually or set SILLY_CODE_HOME."
    }
  }

  [System.IO.Directory]::CreateDirectory($installDir) | Out-Null
  Copy-Item -Path "$extracted\*" -Destination $installDir -Recurse -Force
  Ok "Installed: $installDir"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# ── Vendor ripgrep into install ──────────────────────────────────────────────
if ($rgBin -and (Test-Path $rgBin)) {
  $nodeArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $rgVendorDir = [System.IO.Path]::Combine($installDir, 'pipeline', 'build', 'vendor', 'ripgrep', "$nodeArch-win32")
  [System.IO.Directory]::CreateDirectory($rgVendorDir) | Out-Null
  Copy-Item $rgBin (Join-Path $rgVendorDir 'rg.exe') -Force
}

# ── Create Windows launchers ─────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

# silly (management CLI) — delegates to bin/.lib/silly.js
$sillyCmdContent = "@echo off`r`nset `"SILLY_INSTALL_DIR=$installDir`"`r`nset `"NODE_PATH=%SILLY_INSTALL_DIR%\.deps\node_modules`"`r`nset `"CALLER_DIR=%CD%`"`r`nnode `"%SILLY_INSTALL_DIR%\bin\.lib\silly.js`" %*`r`n"
Set-Content -Path (Join-Path $binDir 'silly.cmd') -Value $sillyCmdContent -Encoding ASCII

# Provider launchers
$providers = @{
  'sillyx'  = 'CLAUDE_CODE_USE_OPENAI=1'
  'sillye'  = ''
  'sillyxs' = 'CLAUDE_CODE_USE_OPENAI=1'
  'sillyes' = ''
}
$skipPerms = @('sillyxs', 'sillyes')

foreach ($cmd in $providers.Keys) {
  $jsFile = "$cmd.js"
  # sillyxs/sillyes delegate to sillyx/sillye with --dangerously-skip-permissions
  if ($skipPerms -contains $cmd) {
    $provider = $cmd.Substring(0, $cmd.Length - 1)
    $jsFile = "$provider.js"
  }
  $extraArg = if ($skipPerms -contains $cmd) { ' --dangerously-skip-permissions' } else { '' }
  $cmdContent = "@echo off`r`nset `"SILLY_INSTALL_DIR=$installDir`"`r`nset `"NODE_PATH=%SILLY_INSTALL_DIR%\.deps\node_modules`"`r`nset `"CALLER_DIR=%CD%`"`r`nnode `"%SILLY_INSTALL_DIR%\bin\.lib\$jsFile`"$extraArg %*`r`n"
  Set-Content -Path (Join-Path $binDir "$cmd.cmd") -Value $cmdContent -Encoding ASCII
}

Ok "Commands: $binDir\silly.cmd, sillyx.cmd, sillye.cmd, sillyxs.cmd, sillyes.cmd"

# ── PATH ─────────────────────────────────────────────────────────────────────
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$normalizedBinDir = ($binDir -replace '/', '\').TrimEnd('\')
$pathEntries = if ($userPath) { ($userPath -split ';') | ForEach-Object { ($_ -replace '/', '\').TrimEnd('\') } } else { @() }
if ($pathEntries -notcontains $normalizedBinDir) {
  $newPath = if ($userPath) { "$binDir;$userPath" } else { $binDir }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  $env:Path = "$binDir;$env:Path"
  Ok "Added $binDir to user PATH"
  Warn 'Open a NEW PowerShell or cmd window for the PATH change to take effect.'
}

# ── State ────────────────────────────────────────────────────────────────────
[System.IO.Directory]::CreateDirectory($dataDir) | Out-Null
$state = "{`"lastChecked`": `"$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))`"}"
Set-Content -Path (Join-Path $dataDir 'deps-state.json') -Value $state -Encoding UTF8

Write-Host ''
Ok 'Installation complete!'
Write-Host ''
Write-Host '  Launch:'
Write-Host '    sillyx    # OpenAI Codex (GPT)'
Write-Host '    sillye    # Claude (Anthropic)'
Write-Host ''
Write-Host '  Login:'
Write-Host '    silly login codex'
Write-Host '    silly login claude'
Write-Host ''
Write-Host '  Update:    silly update'
Write-Host '  Uninstall: silly uninstall'
Write-Host ''
Write-Host "Installed: $installDir"
Write-Host "Commands:  $binDir"
