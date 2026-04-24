// tests/downstream-watchdog.test.cjs — Downstream TUI silent-hang safety net
//
// Locks the Iter 103 Windows P0 fix in bin/silly-launcher.js::launchProvider:
//
//   (a) Watchdog default-on via SILLY_NO_DOWNSTREAM_WATCHDOG !== '1'
//   (b) SILLY_DOWNSTREAM_WATCHDOG_MS tunable (default 10000ms)
//   (c) Watchdog is cleared on first child stdout/stderr byte
//   (d) Exit code 45 when watchdog fires (stable contract for shell wrappers)
//   (e) Exit code 46 when spawn() itself fails (ENOENT etc.)
//   (f) Child stdout/stderr forwarded to launcher stdout/stderr (Ink fidelity)
//   (g) stdin stays 'inherit' so TUI can read keyboard
//
// Strategy: the launcher's downstream watchdog semantics are self-contained
// inside launchProvider. We verify them two ways:
//   1. Static source assertions — the env-flag names, exit codes, and stdio
//      shape must be in silly-launcher.js. Cheap, regression-proof.
//   2. Behavior smoke — inline mini-scripts mirror the exact watchdog pattern
//      (setTimeout + first-output clear + exit 45). Confirms the mechanism
//      actually fires + clears correctly. Avoids spawning the real TUI, so
//      the test stays hermetic and runs in <3s on all 3 OSes.
//
// Part of the main `npm test` runner. See bin/CLAUDE.md "Silent-hang safety
// net" for the user-facing contract.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LAUNCHER = path.join(__dirname, '..', 'bin', 'silly-launcher.js');
const launcher = fs.readFileSync(LAUNCHER, 'utf8');

console.log('Downstream watchdog tests\n');

// ── 1. Env-flag + exit-code declarations in silly-launcher.js ──

(function testDownstreamDeclarations() {
  assert.ok(
    /SILLY_DOWNSTREAM_WATCHDOG_MS/.test(launcher),
    'silly-launcher.js: SILLY_DOWNSTREAM_WATCHDOG_MS override flag missing'
  );
  assert.ok(
    /SILLY_NO_DOWNSTREAM_WATCHDOG\s*!==\s*['"]1['"]/.test(launcher),
    'silly-launcher.js: SILLY_NO_DOWNSTREAM_WATCHDOG opt-out flag missing'
  );
  // Default 10s — short enough to catch real hangs, long enough that a 1-3s
  // cold-start TUI never trips it.
  assert.ok(
    /SILLY_DOWNSTREAM_WATCHDOG_MS\)\s*\|\|\s*10_?000/.test(launcher),
    'silly-launcher.js: downstream watchdog default must be 10000ms'
  );
  console.log('  Downstream env-flag declarations: PASS');
})();

// ── 2. Exit codes 45 (hang) + 46 (spawn fail) are stable contracts ──

(function testDownstreamExitCodes() {
  assert.ok(
    /process\.exit\(45\)/.test(launcher),
    'silly-launcher.js: downstream watchdog must exit(45) — stable "TUI silent hang" contract'
  );
  assert.ok(
    /process\.exit\(46\)/.test(launcher),
    'silly-launcher.js: spawn error handler must exit(46) — stable "spawn failed" contract'
  );
  console.log('  Exit codes 45 + 46 contract: PASS');
})();

// ── 3. stdio shape conditional on print-mode ──
//
// PRINT mode (-p / --print): stdin MUST stay 'inherit' so the adapter can read
//   tool_result input from stdin if upstream requests it; stdout + stderr MUST
//   be 'pipe' so the launcher can observe the first-byte event and clear the
//   watchdog.
// TUI mode (bare): stdio MUST be full 'inherit' — upstream Ink auto-detects
//   non-TTY stdout and silently switches to --print mode, which then fails
//   with "Input must be provided..." for bare launches. Full inherit restores
//   normal TUI rendering at the cost of losing first-output observability.

(function testStdioShape() {
  assert.ok(
    /stdio:\s*_isPrintMode\s*\?\s*\[\s*['"]inherit['"]\s*,\s*['"]pipe['"]\s*,\s*['"]pipe['"]\s*\]\s*:\s*['"]inherit['"]/.test(launcher),
    `silly-launcher.js: launchProvider spawn must conditionally use ['inherit','pipe','pipe'] ` +
    `only in print mode and full 'inherit' for TUI mode (bare) — otherwise upstream ` +
    `auto-switches to --print and rejects bare launch with missing-prompt error`
  );
  console.log('  stdio shape conditional on print mode: PASS');
})();

// ── 4. First-output handlers clear watchdog AND forward to process.stdout/err ──

(function testFirstOutputClearsAndForwards() {
  assert.ok(
    /_firstOutputSeen/.test(launcher),
    'silly-launcher.js: _firstOutputSeen flag missing — first-output detection broken'
  );
  assert.ok(
    /sp\.stdout\.on\(\s*['"]data['"]/.test(launcher),
    'silly-launcher.js: must attach data handler to sp.stdout for forwarding + watchdog clear'
  );
  assert.ok(
    /sp\.stderr\.on\(\s*['"]data['"]/.test(launcher),
    'silly-launcher.js: must attach data handler to sp.stderr for forwarding + watchdog clear'
  );
  assert.ok(
    /process\.stdout\.write\(chunk\)/.test(launcher),
    'silly-launcher.js: child stdout must be forwarded to parent stdout (preserve Ink output)'
  );
  assert.ok(
    /process\.stderr\.write\(chunk\)/.test(launcher),
    'silly-launcher.js: child stderr must be forwarded to parent stderr'
  );
  assert.ok(
    /clearBootWatchdog\(['"]first-output-/.test(launcher),
    'silly-launcher.js: first-output event must clear the boot watchdog with reason first-output-*'
  );
  console.log('  First-output clears watchdog + forwards stdio: PASS');
})();

// ── 5. Watchdog timer is .unref()'d so clean exit is not blocked ──

(function testDownstreamUnref() {
  assert.ok(
    /_downstreamDeadline\.unref\(\)/.test(launcher),
    'silly-launcher.js: _downstreamDeadline.unref() required so normal TUI exit is not blocked'
  );
  console.log('  Downstream watchdog unref(): PASS');
})();

// ── 5b. Race-safe teardown: _watchdogFired guard in sp.on('exit') ──
//
// Without this guard, SIGTERM kills the child fast → sp.on('exit') fires →
// process.exit(child_code ?? 0) wins before the kill-then-exit(45) timer.
// Result: watchdog FATAL message prints but the process exits 0, hiding
// the diagnosis from shell wrappers / CI / user.

(function testWatchdogFiredGuard() {
  assert.ok(
    /_watchdogFired/.test(launcher),
    'silly-launcher.js: _watchdogFired flag missing — race-safe teardown broken'
  );
  assert.ok(
    /if\s*\(\s*_watchdogFired\s*\)\s*process\.exit\(45\)/.test(launcher),
    'silly-launcher.js: sp.on(exit) must check _watchdogFired and force exit(45) — ' +
    'otherwise SIGTERM-induced child death leaks out as exit 0 and hides the diagnosis'
  );
  console.log('  Race-safe _watchdogFired guard forces exit(45): PASS');
})();

// ── 6. Behavior smoke — watchdog fires exit 45 when child produces no output ──
//
// Mirror the exact launcher pattern inline: spawn a child that sleeps silently,
// set a short watchdog, assert exit 45 + FATAL message. Uses inline node scripts
// so the test has no external fixtures.

(function testWatchdogFiresOnSilentChild() {
  // Mirror launcher race-safe teardown: _watchdogFired flag + exit handler
  // must force exit(45) even when SIGTERM makes the child die first.
  const snippet = `
    const { spawn } = require('child_process');
    // Silent child: sleeps for 3s without writing anything
    const sp = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 3000)'], {
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let _firstOutputSeen = false;
    let _watchdogFired = false;
    const _markOutput = () => { _firstOutputSeen = true; };
    sp.stdout.on('data', (c) => { _markOutput(); process.stdout.write(c); });
    sp.stderr.on('data', (c) => { _markOutput(); process.stderr.write(c); });
    const _downstreamDeadline = setTimeout(() => {
      if (_firstOutputSeen) return;
      _watchdogFired = true;
      process.stderr.write('[silly][FATAL] Claude Code TUI did not emit any output within 300ms.\\n');
      try { sp.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { sp.kill('SIGKILL'); } catch {} process.exit(45); }, 500);
    }, 300);
    _downstreamDeadline.unref();
    sp.on('exit', (code) => {
      clearTimeout(_downstreamDeadline);
      if (_watchdogFired) process.exit(45);
      process.exit(code ?? 0);
    });
  `;
  const r = spawnSync(process.execPath, ['-e', snippet], {
    encoding: 'utf8',
    timeout: 8_000,
  });
  assert.strictEqual(
    r.status, 45,
    `Silent child should trigger watchdog exit 45, got ${r.status}.\nstderr: ${r.stderr}`
  );
  assert.ok(
    /\[silly\]\[FATAL\] Claude Code TUI did not emit/.test(r.stderr),
    `FATAL stderr message missing — got: ${r.stderr}`
  );
  console.log('  Silent child → watchdog exit=45: PASS');
})();

// ── 7. Behavior smoke — watchdog CLEARED when child writes first byte ──
//
// Child writes 'x' immediately. First-output handler must set the flag, the
// watchdog (short deadline) fires and checks `_firstOutputSeen`, sees true,
// returns without killing. Child then exits 0 naturally → parent exits 0.

(function testWatchdogClearedOnOutput() {
  const snippet = `
    const { spawn } = require('child_process');
    // Eager child: writes immediately then exits with code 0
    const sp = spawn(process.execPath, ['-e', 'process.stdout.write("x\\\\n")'], {
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let _firstOutputSeen = false;
    const _markOutput = () => { _firstOutputSeen = true; };
    sp.stdout.on('data', (c) => { _markOutput(); process.stdout.write(c); });
    sp.stderr.on('data', (c) => { _markOutput(); process.stderr.write(c); });
    const _downstreamDeadline = setTimeout(() => {
      if (_firstOutputSeen) return;
      process.stderr.write('WATCHDOG WRONGLY FIRED\\n');
      process.exit(45);
    }, 300);
    _downstreamDeadline.unref();
    sp.on('exit', (code) => { clearTimeout(_downstreamDeadline); process.exit(code ?? 0); });
  `;
  const r = spawnSync(process.execPath, ['-e', snippet], {
    encoding: 'utf8',
    timeout: 8_000,
  });
  assert.strictEqual(
    r.status, 0,
    `Eager child should exit 0 (watchdog cleared), got ${r.status}.\nstderr: ${r.stderr}`
  );
  assert.ok(
    !/WATCHDOG WRONGLY FIRED/.test(r.stderr),
    `Watchdog fired despite first-output — first-output clear path broken`
  );
  assert.strictEqual(
    r.stdout, 'x\n',
    `Child stdout should be forwarded verbatim, got: ${JSON.stringify(r.stdout)}`
  );
  console.log('  Eager child output → watchdog cleared, exit=0: PASS');
})();

// ── 8. Behavior smoke — child non-zero exit code is transparently propagated ──

(function testChildExitCodePropagation() {
  const snippet = `
    const { spawn } = require('child_process');
    const sp = spawn(process.execPath, ['-e', 'process.exit(7)'], {
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let _firstOutputSeen = false;
    sp.stdout.on('data', (c) => { _firstOutputSeen = true; process.stdout.write(c); });
    sp.stderr.on('data', (c) => { _firstOutputSeen = true; process.stderr.write(c); });
    const _downstreamDeadline = setTimeout(() => {
      if (_firstOutputSeen) return;
      process.exit(45);
    }, 1000);
    _downstreamDeadline.unref();
    sp.on('exit', (code) => { clearTimeout(_downstreamDeadline); process.exit(code ?? 0); });
  `;
  const r = spawnSync(process.execPath, ['-e', snippet], {
    encoding: 'utf8',
    timeout: 8_000,
  });
  assert.strictEqual(
    r.status, 7,
    `Child exit code 7 should propagate transparently, got ${r.status}.\nstderr: ${r.stderr}`
  );
  console.log('  Child exit code propagated transparently: PASS');
})();

console.log('\nAll downstream-watchdog tests passed.');
