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

# ── palette (warm-workshop, ANSI 256-color) ────────────────────
# PowerShell 7+ renders ANSI escapes natively. PS5.x falls back to
# VirtualTerminalLevel which still emits them. NO_COLOR opts out.
$e = [char]27
if ($env:NO_COLOR) {
  $C_RESET=''; $C_DIM=''; $C_BOLD=''; $C_ITAL=''
  $C_BRAND=''; $C_LIME=''; $C_TAN=''
  $C_OK=''; $C_INFO=''; $C_WARN=''; $C_ERR=''; $C_MUTED=''
} else {
  $C_RESET="$e[0m"; $C_DIM="$e[2m"; $C_BOLD="$e[1m"; $C_ITAL="$e[3m"
  $C_BRAND="$e[38;5;215m"; $C_LIME="$e[38;5;192m"; $C_TAN="$e[38;5;180m"
  $C_OK="$e[38;5;114m"; $C_INFO="$e[38;5;110m"; $C_WARN="$e[38;5;214m"
  $C_ERR="$e[38;5;174m"; $C_MUTED="$e[38;5;244m"
}

function Section($name) { Write-Host ""; Write-Host "  $C_BOLD$C_BRAND▸$C_RESET $C_BOLD$name$C_RESET" }
function Info($msg)     { Write-Host "      $C_INFO⋯$C_RESET $msg$C_MUTED`u{2026}$C_RESET" }
function Ok($msg)       { Write-Host "      $C_OK✓$C_RESET $msg" }
function Warn($msg)     { Write-Host "      $C_WARN▲$C_RESET $msg" }
function Fail($msg)     { Write-Host "      $C_ERR✕$C_RESET $msg"; throw "[silly] $msg" }
function Dim($msg)      { Write-Host "      $C_MUTED$msg$C_RESET" }
function Divider()      { Write-Host ""; Write-Host "  $C_DIM────────────────────────────────────────────────────$C_RESET" }

# ── banner ─────────────────────────────────────────────────────
Write-Host ''
Write-Host "        $C_TAN╭──────╮$C_RESET          $C_BOLD$C_BRAND`Silly Code$C_RESET"
Write-Host "        $C_TAN│$C_LIME ◕  ◕ $C_TAN│$C_RESET          $C_MUTED──────────$C_RESET"
Write-Host "        $C_TAN│$C_LIME  ▽   $C_TAN│$C_RESET          $C_ITAL$C_MUTED`multi-provider ai$C_RESET"
Write-Host "        $C_TAN╰─┬──┬─╯$C_RESET          $C_ITAL$C_MUTED`first-time install$C_RESET"
Write-Host "          $C_TAN│  │$C_RESET"
Write-Host "         $C_TAN╱    ╲$C_RESET"

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
# Resolve an actual rg.exe file path (not a shim/alias/function). `(Get-Command rg).Source`
# returns shim paths on Scoop/Chocolatey that Test-Path rejects, so we fall through to
# where.exe (returns real paths) and finally to the download branch.
$rgBin = $null
if (Get-Command rg -ErrorAction SilentlyContinue) {
  $rgWhere = & where.exe rg.exe 2>$null | Select-Object -First 1
  if ($rgWhere -and (Test-Path $rgWhere)) {
    $rgBin = $rgWhere
    Ok "ripgrep: $rgBin ($(rg --version | Select-Object -First 1))"
  }
}
if (-not $rgBin -and (Test-Path (Join-Path $binDir 'rg.exe'))) {
  $rgBin = Join-Path $binDir 'rg.exe'
  Ok "ripgrep: $rgBin"
}
if (-not $rgBin) {
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

# ── Vendor ripgrep so patch.cjs fail-fast passes ─────────────
# MUST run BEFORE patch.cjs: patch.cjs exits 1 if vendor/ripgrep missing on
# Windows (no npx cache fallback). Installer stages rg.exe here so patch.cjs
# sees a pre-populated vendor dir.
if ($rgBin -and (Test-Path $rgBin)) {
  $nodeArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $rgVendorDir = [System.IO.Path]::Combine($installDir, 'pipeline', 'build', 'vendor', 'ripgrep', "$nodeArch-win32")
  New-Item -ItemType Directory -Force -Path $rgVendorDir | Out-Null
  Copy-Item $rgBin (Join-Path $rgVendorDir 'rg.exe') -Force
  Ok "Vendored ripgrep: $rgVendorDir\rg.exe"
}

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
# silly-diag shim — standalone Windows install diagnostic (no launcher, no watchdog)
$diagJs = Join-Path $installDir 'bin\silly-diag.js'
$diagContent = "@echo off`r`nnode `"$diagJs`" %*`r`n"
Set-Content -Path (Join-Path $binDir 'silly-diag.cmd') -Value $diagContent -Encoding ASCII -NoNewline
Ok "Commands: $binDir\{silly,sillyx,sillye,sillyxs,sillyes,silly-diag}.cmd"

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

# ── Self-smoke test ───────────────────────────────────────────
# Immediately invoke one of the just-created .cmd wrappers so any boot-time
# breakage surfaces at install time, not at first user invocation. A silent
# install followed by a silent `sillye` hang is the exact failure mode this
# pass exists to eliminate.
Info 'Self-smoke test...'
# Defensive wrapper: if the user has SILLY_TRACE_BOOT=1 set in this session,
# the .cmd shim writes heartbeat lines to stderr. PowerShell's `& cmd 2>&1`
# surfaces those as RemoteException/NativeCommandError, and if the caller
# set $ErrorActionPreference = 'Stop' (common in CI pipelines) the whole
# installer aborts at this line. We therefore:
#   1. Temporarily clear SILLY_TRACE_BOOT so the shim stays silent
#   2. Save + restore so we don't mutate the user's env for later sillye runs
#   3. Redirect stderr to $null (stdout-only parse — --version writes stdout)
#   4. try/catch/finally with ErrorActionPreference='Continue' to defang
#      any residual NativeCommandError
$savedTrace = $env:SILLY_TRACE_BOOT
$env:SILLY_TRACE_BOOT = ''
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $smoke = & "$binDir\sillye.cmd" --version 2>$null
  $smokeCode = $LASTEXITCODE
} catch {
  $smoke = "Exception: $($_.Exception.Message)"
  $smokeCode = 1
} finally {
  $ErrorActionPreference = $prevEAP
  if ($savedTrace) { $env:SILLY_TRACE_BOOT = $savedTrace } else { Remove-Item Env:\SILLY_TRACE_BOOT -ErrorAction SilentlyContinue }
}
if ($smokeCode -ne 0 -or [string]::IsNullOrWhiteSpace($smoke)) {
  Warn "Self-smoke failed (exit=$smokeCode output='$smoke')"
  Warn 'Try: $env:SILLY_TRACE_BOOT=1; sillye --version  (in a fresh shell)'
} else {
  Ok "Self-smoke: $smoke"
}

Divider
Write-Host ''
Write-Host "  $C_BOLD`ready$C_RESET  $C_MUTED· type:$C_RESET"
Write-Host ''
Write-Host "      $C_BRAND`sillyx$C_RESET              $C_MUTED`openai codex · gpt$C_RESET"
Write-Host "      $C_BRAND`sillye$C_RESET              $C_MUTED`anthropic · claude$C_RESET"
Write-Host "      $C_DIM$C_MUTED`sillyxs / sillyes   same, --dangerously-skip-permissions$C_RESET"
Write-Host ''
Write-Host "  $C_BOLD`first-time login$C_RESET"
Write-Host ''
Write-Host "      $C_BRAND`silly login codex$C_RESET"
Write-Host "      $C_BRAND`silly login claude$C_RESET"
Write-Host ''
Write-Host "  $C_MUTED`update:     $C_RESET$C_BRAND`silly update$C_RESET       $C_MUTED`git pull + rebuild$C_RESET"
Write-Host "  $C_MUTED`uninstall:  $C_RESET$C_BRAND`silly uninstall$C_RESET"
Write-Host ''
Write-Host "  $C_MUTED`installed:  $installDir$C_RESET"
Write-Host "  $C_MUTED`commands:   $binDir$C_RESET"
Write-Host ''
