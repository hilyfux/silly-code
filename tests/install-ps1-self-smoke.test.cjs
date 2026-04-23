// tests/install-ps1-self-smoke.test.cjs — install.ps1 self-smoke defense lock
//
// Problem this test guards against:
//
// The self-smoke test at the tail of install.ps1 invokes `sillye.cmd
// --version` to prove the just-installed binary can at least boot. When the
// caller runs install.ps1 from a PowerShell session that already has
// `SILLY_TRACE_BOOT=1` set, the .cmd shim writes heartbeat lines to stderr.
// PowerShell's native-command error-surface treats those stderr lines as
// RemoteException / NativeCommandError, and if the caller has set
// `$ErrorActionPreference = 'Stop'` (common in CI pipelines), the installer
// aborts at the self-smoke line with red text — even though nothing
// actually failed.
//
// Real failure trace observed:
//   [silly] Self-smoke test...
//   sillye.cmd : [silly-boot +0ms shim] sillye.cmd entry at 22:45:20.75
//   所在位置 行:202 字符: 10
//   + $smoke = & "$binDir\sillye.cmd" --version 2>&1
//
// Fix: wrap the self-smoke in a defensive block that
//   (a) temporarily clears SILLY_TRACE_BOOT (save + restore user's env)
//   (b) redirects stderr to $null (2>$null) — stdout-only parse for
//       --version, which writes to stdout anyway
//   (c) uses try/catch/finally with $ErrorActionPreference='Continue' to
//       defang NativeCommandError throws when the caller has 'Stop' set
//
// Both install.ps1 (root, mirror) and installer/install.ps1 (source of
// truth) must carry the same defensive block.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

console.log('install.ps1 self-smoke defense tests\n');

const CANONICAL_PATHS = ['installer/install.ps1', 'install.ps1'];

function readInstallPs1(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// Extract just the self-smoke block so assertions are scoped (avoid
// accidentally matching unrelated try/catch elsewhere in the file).
function extractSelfSmokeBlock(src, relPath) {
  const startIdx = src.indexOf("Info 'Self-smoke test...'");
  assert.ok(
    startIdx !== -1,
    `${relPath}: cannot locate "Info 'Self-smoke test...'" marker — self-smoke block missing?`
  );
  // Block ends at the next "Write-Host ''" or "Ok 'Installation complete!'"
  const tailMarker = /Ok\s+'Installation complete!'/;
  const tailMatch = tailMarker.exec(src.slice(startIdx));
  assert.ok(
    tailMatch,
    `${relPath}: cannot locate end-of-self-smoke anchor (Ok 'Installation complete!')`
  );
  return src.slice(startIdx, startIdx + tailMatch.index);
}

// ── 1. stderr suppression ─────────────────────────────────────
(function testStderrRedirect() {
  for (const relPath of CANONICAL_PATHS) {
    const block = extractSelfSmokeBlock(readInstallPs1(relPath), relPath);
    assert.ok(
      /2>\$null/.test(block),
      `${relPath}: self-smoke must redirect stderr to $null (2>$null) — ` +
        `SILLY_TRACE_BOOT=1 session heartbeat text would otherwise be surfaced ` +
        `as NativeCommandError`
    );
    // Guard against regression to 2>&1 — that was the exact failing form
    assert.ok(
      !/sillye\.cmd['"]?\s+--version\s+2>&1/.test(block),
      `${relPath}: self-smoke MUST NOT use 2>&1 on the sillye.cmd call ` +
        `(reintroduces SILLY_TRACE_BOOT=1 NativeCommandError bug)`
    );
  }
  console.log('  self-smoke 2>$null stderr suppression (both copies): PASS');
})();

// ── 2. Save + clear + restore SILLY_TRACE_BOOT env ────────────
(function testTraceEnvSaveRestore() {
  for (const relPath of CANONICAL_PATHS) {
    const block = extractSelfSmokeBlock(readInstallPs1(relPath), relPath);
    // Save user's current value
    assert.ok(
      /\$savedTrace\s*=\s*\$env:SILLY_TRACE_BOOT/.test(block),
      `${relPath}: self-smoke must save the user's SILLY_TRACE_BOOT via $savedTrace`
    );
    // Clear for the duration of the smoke call
    assert.ok(
      /\$env:SILLY_TRACE_BOOT\s*=\s*''/.test(block),
      `${relPath}: self-smoke must clear $env:SILLY_TRACE_BOOT to '' before ` +
        `invoking sillye.cmd (otherwise shim writes heartbeat to stderr)`
    );
    // Restore — either assign back or Remove-Item if it was originally unset
    assert.ok(
      /if\s*\(\s*\$savedTrace\s*\)/.test(block),
      `${relPath}: self-smoke must conditionally restore $savedTrace in finally`
    );
    assert.ok(
      /Remove-Item\s+Env:\\?SILLY_TRACE_BOOT/.test(block),
      `${relPath}: self-smoke must Remove-Item Env:SILLY_TRACE_BOOT when the ` +
        `user originally had it unset (don't leak empty string into caller env)`
    );
  }
  console.log('  self-smoke SILLY_TRACE_BOOT save/clear/restore (both copies): PASS');
})();

// ── 3. try/catch/finally wrap ─────────────────────────────────
(function testTryCatchFinally() {
  for (const relPath of CANONICAL_PATHS) {
    const block = extractSelfSmokeBlock(readInstallPs1(relPath), relPath);
    // All three keywords required — each plays a distinct role:
    //   try    — isolate NativeCommandError throw
    //   catch  — convert throw into $smokeCode=1 so we still warn, not abort
    //   finally — guarantee SILLY_TRACE_BOOT and ErrorActionPreference restored
    assert.ok(/\btry\s*\{/.test(block), `${relPath}: self-smoke missing try { ... }`);
    assert.ok(/\}\s*catch\s*\{/.test(block), `${relPath}: self-smoke missing catch { ... }`);
    assert.ok(/\}\s*finally\s*\{/.test(block), `${relPath}: self-smoke missing finally { ... }`);
  }
  console.log('  self-smoke try/catch/finally wrap (both copies): PASS');
})();

// ── 4. ErrorActionPreference defense ──────────────────────────
(function testErrorActionPreference() {
  for (const relPath of CANONICAL_PATHS) {
    const block = extractSelfSmokeBlock(readInstallPs1(relPath), relPath);
    // Save previous preference
    assert.ok(
      /\$prevEAP\s*=\s*\$ErrorActionPreference/.test(block),
      `${relPath}: self-smoke must save $ErrorActionPreference into $prevEAP`
    );
    // Force 'Continue' for the duration of the smoke call — this is the
    // NativeCommandError defense for callers running with 'Stop'
    assert.ok(
      /\$ErrorActionPreference\s*=\s*'Continue'/.test(block),
      `${relPath}: self-smoke must set $ErrorActionPreference = 'Continue' ` +
        `to defang NativeCommandError throws under Stop-mode callers`
    );
    // Restore in finally
    assert.ok(
      /\$ErrorActionPreference\s*=\s*\$prevEAP/.test(block),
      `${relPath}: self-smoke must restore $ErrorActionPreference = $prevEAP in finally`
    );
  }
  console.log('  self-smoke ErrorActionPreference defense (both copies): PASS');
})();

// ── 5. Exit-code + empty-output branching ─────────────────────
(function testExitCodeAndOutputCheck() {
  for (const relPath of CANONICAL_PATHS) {
    const block = extractSelfSmokeBlock(readInstallPs1(relPath), relPath);
    // Capture LASTEXITCODE into $smokeCode inside the try block — the catch
    // branch assigns $smokeCode = 1 so both paths converge on a single name.
    assert.ok(
      /\$smokeCode\s*=\s*\$LASTEXITCODE/.test(block),
      `${relPath}: self-smoke must capture $LASTEXITCODE into $smokeCode (try branch)`
    );
    assert.ok(
      /\$smokeCode\s*=\s*1/.test(block),
      `${relPath}: self-smoke catch branch must set $smokeCode = 1`
    );
    // Final branching must check both exit code AND empty output (a shim that
    // silently no-ops to exit 0 with empty stdout is still a boot failure)
    assert.ok(
      /\$smokeCode\s+-ne\s+0/.test(block),
      `${relPath}: self-smoke final branch must test $smokeCode -ne 0`
    );
    assert.ok(
      /IsNullOrWhiteSpace\(\$smoke\)/.test(block),
      `${relPath}: self-smoke final branch must also test ` +
        `[string]::IsNullOrWhiteSpace($smoke) — empty stdout is a failure too`
    );
  }
  console.log('  self-smoke $smokeCode capture + empty-output check (both copies): PASS');
})();

// ── 6. Parity between root mirror and installer/ source-of-truth ──
(function testParityOfSelfSmokeBlocks() {
  const mirrorBlock = extractSelfSmokeBlock(readInstallPs1('install.ps1'), 'install.ps1');
  const sourceBlock = extractSelfSmokeBlock(
    readInstallPs1('installer/install.ps1'),
    'installer/install.ps1'
  );
  // Byte-exact parity — the self-smoke block is the exact surface that
  // breaks under SILLY_TRACE_BOOT=1, and the root install.ps1 is a
  // machine-synced mirror of installer/install.ps1 (.github/workflows/
  // sync-installer.yml). Drift between the two = mirror out of date.
  assert.strictEqual(
    mirrorBlock,
    sourceBlock,
    `install.ps1 and installer/install.ps1 self-smoke blocks must be byte-identical ` +
      `(mirror sync drift)`
  );
  console.log('  self-smoke block parity (root mirror == installer/ source): PASS');
})();

console.log('\nAll install-ps1-self-smoke tests passed.');
