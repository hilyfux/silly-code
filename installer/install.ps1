$ErrorActionPreference = 'Stop'

# silly-code installer (open-source, Windows)
# Usage: irm https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1 | iex
#
# Source-install model: clones the repo with git, runs the patch pipeline
# locally, drops .cmd wrappers into ~/.local/bin. No tarball download (avoids
# the PS5.x TLS class of bugs entirely), no bin/.lib relocation (the launcher
# reads cli-patched.js in place), no double-spawn (one Node process per cmd).

$installDir = if ($env:SILLY_CODE_HOME) { $env:SILLY_CODE_HOME } else { Join-Path $HOME '.local\share\silly-code' }
$binDir     = Join-Path $HOME '.local\bin'
$dataDir    = if ($env:SILLY_CODE_DATA) { $env:SILLY_CODE_DATA } else { Join-Path $HOME '.silly-code' }
$repoUrl    = if ($env:SILLY_CODE_REPO) { $env:SILLY_CODE_REPO } else { 'https://github.com/hilyfux/silly-code.git' }
$branch     = if ($env:SILLY_CODE_BRANCH) { $env:SILLY_CODE_BRANCH } else { 'main' }

function Info($msg) { Write-Host "[silly] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[silly] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[silly] $msg" -ForegroundColor Yellow }
function Fail($msg) { throw "[silly] $msg" }

Write-Host ''
Write-Host '  silly-code installer (open-source)' -ForegroundColor Cyan
Write-Host ''

# ── Prerequisites ──────────────────────────────────────────────
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "git is required. Install Git for Windows: https://git-scm.com/download/win"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js >= 20 is required. Install: https://nodejs.org"
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
  Fail "Node.js >= 20 required (found $(node --version))."
}
Ok "git:  $((git --version) -replace '^git version ','')"
Ok "node: $(node --version)"

# ── ripgrep (optional but recommended) ─────────────────────────
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
  Info "Installing ripgrep $rgVersion to $binDir..."
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    $zipPath = Join-Path $tmp 'rg.zip'
    # git is already required above, so we can use git's bundled curl as a
    # cross-host download path (avoids PS5 TLS bugs). Falls back to .NET if
    # curl is not on PATH (Windows 10 1803+ ships it; some minimal setups don't).
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
      & curl.exe -fsSL -o $zipPath $rgUrl
    } else {
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -Uri $rgUrl -OutFile $zipPath -UseBasicParsing
    }
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

# ── Clone or update repo ───────────────────────────────────────
if (Test-Path (Join-Path $installDir '.git')) {
  Info "Updating existing checkout in $installDir..."
  & git -C $installDir fetch --quiet origin $branch
  & git -C $installDir reset --hard --quiet "origin/$branch"
} elseif (Test-Path $installDir) {
  $isSillyInstall = (Test-Path (Join-Path $installDir 'versions')) -or
                    (Test-Path (Join-Path $installDir 'pipeline\build\cli-patched.js')) -or
                    (Test-Path (Join-Path $installDir 'bin\silly')) -or
                    ((Get-ChildItem $installDir -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0)
  if ($isSillyInstall) {
    Warn "Replacing previous install at $installDir (was: dist tarball or empty)"
    Remove-Item -Recurse -Force $installDir
    New-Item -ItemType Directory -Force -Path (Split-Path $installDir -Parent) | Out-Null
    & git clone --quiet --branch $branch --depth 1 $repoUrl $installDir
  } else {
    Fail "$installDir exists and is not a silly-code install. Remove it manually or set SILLY_CODE_HOME."
  }
} else {
  Info "Cloning $repoUrl -> $installDir..."
  New-Item -ItemType Directory -Force -Path (Split-Path $installDir -Parent) | Out-Null
  & git clone --quiet --branch $branch --depth 1 $repoUrl $installDir
}
$headSha = (& git -C $installDir rev-parse --short HEAD).Trim()
Ok "Repo: $installDir ($headSha)"

# ── Build patched binary ───────────────────────────────────────
# patch.cjs is pure text transformation + deploys vendored ws into
# pipeline\build\node_modules\ws. Zero downloads at this step. The clone is
# complete: vendor\ws\ ships in the repo (~192KB, MIT-licensed).
Info 'Applying patches (node pipeline\patch.cjs)...'
Push-Location $installDir
try {
  & node pipeline/patch.cjs | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "Patch pipeline failed with exit $LASTEXITCODE" }
} finally {
  Pop-Location
}
Ok "Patched binary: $installDir\pipeline\build\cli-patched.js"

$wsPkg = Join-Path $installDir 'pipeline\build\node_modules\ws\package.json'
if (-not (Test-Path $wsPkg)) {
  Fail "Vendored ws missing after patch.cjs — repo corrupt. Reinstall via the install URL."
}

# ── Vendor ripgrep so adapter can find it ────────────────────
if ($rgBin -and (Test-Path $rgBin)) {
  $nodeArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $rgVendorDir = [System.IO.Path]::Combine($installDir, 'pipeline', 'build', 'vendor', 'ripgrep', "$nodeArch-win32")
  New-Item -ItemType Directory -Force -Path $rgVendorDir | Out-Null
  Copy-Item $rgBin (Join-Path $rgVendorDir 'rg.exe') -Force
}

# ── Create Windows .cmd launchers ─────────────────────────────
# Each wrapper spawns `node <install>\bin\<cmd>.js` directly, but first
# guarantees a visible heartbeat even when node itself cannot start:
#
#   * `@echo off` suppresses command echo, so any silent failure below would
#     leave the user with zero output — that is exactly the Windows silent-
#     hang class we are eliminating here.
#   * The `where node` probe short-circuits with an actionable, ALWAYS-on
#     stderr line (exit /b 127) when Node is not on PATH. No env-flag gate —
#     that failure mode is FATAL and must always print.
#   * SILLY_TRACE_BOOT=1 adds timestamped "entry at %time%" heartbeats from
#     the shim itself, which fire BEFORE any Node instrumentation. Combined
#     with the 5s pre-launcher watchdog in bin\*.js and the 30s in-launcher
#     watchdog, users always get a trace chain that points at the exact
#     frame where boot stopped advancing.
#   * All shim output redirects to stderr (1>&2) so it never pollutes the
#     adapter stdout pipe.
#   * `exit /b %_exit%` propagates Node's exit code so PowerShell/cmd
#     $LASTEXITCODE remains accurate.
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
foreach ($cmd in @('silly', 'sillyx', 'sillye', 'sillyxs', 'sillyes')) {
  $jsPath = Join-Path $installDir "bin\$cmd.js"
  $cmdContent = @"
@echo off
REM silly-boot heartbeat — must always print even if node fails
if "%SILLY_TRACE_BOOT%"=="1" (
  echo [silly-boot +0ms shim] $cmd.cmd entry at %time% 1>&2
  echo [silly-boot +0ms shim] node path: "$jsPath" 1>&2
)
where node >nul 2>&1 || (echo [silly][FATAL] 'node' not found in PATH. Install Node.js 20+ from https://nodejs.org 1>&2 & exit /b 127)
node "$jsPath" %*
set _exit=%errorlevel%
if "%SILLY_TRACE_BOOT%"=="1" echo [silly-boot shim] node exited code=%_exit% 1>&2
exit /b %_exit%
"@
  # PowerShell here-strings emit LF line endings; Windows batch tolerates LF
  # but some tooling and older CMD versions expect CRLF. Normalize to CRLF.
  $cmdContent = ($cmdContent -replace "`r?`n", "`r`n")
  Set-Content -Path (Join-Path $binDir "$cmd.cmd") -Value $cmdContent -Encoding ASCII -NoNewline
}
Ok "Commands: $binDir\{silly,sillyx,sillye,sillyxs,sillyes}.cmd"

# ── PATH ──────────────────────────────────────────────────────
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

# ── State ─────────────────────────────────────────────────────
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
Write-Host '  Update:    silly update      # git pull + rebuild patches'
Write-Host '  Uninstall: silly uninstall'
Write-Host ''
Write-Host "Installed: $installDir"
Write-Host "Commands:  $binDir"
