$ErrorActionPreference = 'Stop'

$repo = 'https://github.com/hilyfux/silly-code.git'
$installDir = if ($env:SILLY_CODE_HOME) { $env:SILLY_CODE_HOME } else { Join-Path $HOME '.local/share/silly-code' }
$binDir = Join-Path $HOME '.local/bin'
$dataDir = if ($env:SILLY_CODE_DATA) { $env:SILLY_CODE_DATA } else { Join-Path $HOME '.silly-code' }

function Info($msg) { Write-Host "[silly] $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "[silly] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[silly] $msg" -ForegroundColor Yellow }
function Fail($msg) { throw "[silly] $msg" }

Write-Host ''
Write-Host '  silly-code installer' -ForegroundColor Cyan
Write-Host ''

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail 'git is required. Install Git for Windows first.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js >= 20 is required. Install it first.'
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
  Fail "Node.js >= 20 is required. Found $(node --version)."
}
Ok "Node: $(node --version)"

if (-not (Get-Command rg -ErrorAction SilentlyContinue)) {
  Warn 'ripgrep not found. Install it manually or continue with slower search until we add a native Windows bundle.'
} else {
  Ok "ripgrep: $((rg --version | Select-Object -First 1))"
}

if (Test-Path (Join-Path $installDir '.git')) {
  Info 'Updating...'
  git -C $installDir pull --ff-only origin main | Out-Null
} else {
  if (Test-Path $installDir) {
    $looksSafe = (Test-Path (Join-Path $installDir 'package.json')) -or (Test-Path (Join-Path $installDir 'bin/silly')) -or ((Get-ChildItem $installDir -Force | Measure-Object).Count -eq 0)
    if ($looksSafe) {
      Remove-Item -Recurse -Force $installDir
    } else {
      Fail "$installDir exists and is not a silly-code install. Remove it manually or set SILLY_CODE_HOME to a different path."
    }
  }
  Info 'Cloning silly-code...'
  git clone --depth 1 $repo $installDir | Out-Null
}
Ok "Source: $installDir"

Push-Location $installDir
try {
  $upstreamCli = Join-Path $installDir 'pipeline/upstream/package/cli.js'
  if (-not (Test-Path $upstreamCli)) {
    Info 'Fetching upstream Claude Code binary...'
    $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $tmpDir | Out-Null
    try {
      $tgzName = (& npm pack @anthropic-ai/claude-code --pack-destination $tmpDir 2>$null | Select-Object -Last 1).Trim()
      if (-not $tgzName) {
        $tgz = Get-ChildItem -Path $tmpDir -Filter 'anthropic-ai-claude-code-*.tgz' | Select-Object -First 1
        $tgzName = if ($tgz) { $tgz.Name } else { $null }
      }
      if (-not $tgzName) {
        Fail 'Failed to fetch upstream binary. Run: npm pack @anthropic-ai/claude-code'
      }
      tar -xzf (Join-Path $tmpDir $tgzName) -C (Join-Path $installDir 'pipeline/upstream')
    } finally {
      Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path $upstreamCli)) {
      Fail 'Failed to fetch upstream binary. Run: npm pack @anthropic-ai/claude-code'
    }
    Ok 'Upstream binary fetched'
  }

  Info 'Building patched binary...'
  node (Join-Path $installDir 'pipeline/patch.cjs')
  Ok 'Patched binary ready'

  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $psLauncherTemplate = @'
#!/usr/bin/env pwsh
$installDir = '__INSTALL_DIR__'
& node (Join-Path $installDir 'bin/__CMD__.js') @args
'@
  $cmdLauncherTemplate = @'
@echo off
set "INSTALL_DIR=__INSTALL_DIR__"
node "%INSTALL_DIR%\bin\__CMD__.js" %*
'@
  foreach ($cmd in @('silly','sillyx','sillye')) {
    $escapedInstallDir = $installDir.Replace("'", "''")
    $psContent = $psLauncherTemplate.Replace('__INSTALL_DIR__', $escapedInstallDir).Replace('__CMD__', $cmd)
    Set-Content -Path (Join-Path $binDir "$cmd.ps1") -Value $psContent -Encoding UTF8
    $cmdContent = $cmdLauncherTemplate.Replace('__INSTALL_DIR__', $installDir).Replace('__CMD__', $cmd)
    Set-Content -Path (Join-Path $binDir "$cmd.cmd") -Value $cmdContent -Encoding ASCII
  }
  foreach ($cmd in @('sillyxs','sillyes')) {
    $provider = $cmd.Substring(0, $cmd.Length - 1)
    $psContent = @"
#!/usr/bin/env pwsh
& node '$($installDir.Replace("'", "''"))\bin\$provider.js' --dangerously-skip-permissions @args
"@
    Set-Content -Path (Join-Path $binDir "$cmd.ps1") -Value $psContent -Encoding UTF8
    $cmdContent = @"
@echo off
set "INSTALL_DIR=$installDir"
node "%INSTALL_DIR%\bin\$provider.js" --dangerously-skip-permissions %*
"@
    Set-Content -Path (Join-Path $binDir "$cmd.cmd") -Value $cmdContent -Encoding ASCII
  }
  Ok "Commands: $binDir\silly(.cmd/.ps1), sillyx(.cmd/.ps1), sillye(.cmd/.ps1)"

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $pathEntries = @()
  if ($userPath) { $pathEntries = $userPath -split ';' }
  if ($pathEntries -notcontains $binDir) {
    $newUserPath = if ($userPath) { "$binDir;$userPath" } else { $binDir }
    [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
    $env:Path = "$binDir;$env:Path"
    Ok "Added $binDir to your user PATH"
    Warn 'Restart PowerShell to pick up the new PATH in new terminals.'
  }

  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $state = @{ lastChecked = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } | ConvertTo-Json -Compress
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
  Write-Host "Installed under: $installDir"
  Write-Host "Launchers under: $binDir"
  Write-Host 'Windows shells will use the .cmd wrappers automatically.'
} finally {
  Pop-Location
}
