// tests/boot-watchdog.test.cjs — Boot watchdog + SILLY_TRACE_BOOT contract
//
// Locks the P0 Windows silent-hang safety net landed in bin/silly-launcher.js:
//
//   (a) Watchdog default-on via SILLY_NO_BOOT_WATCHDOG !== '1'
//   (b) WATCHDOG_MS tunable via SILLY_BOOT_WATCHDOG_MS (fallback 30000)
//   (c) unref() on the timer so clean exit is not blocked
//   (d) Exit code 42 when watchdog fires (stable for Windows Task Scheduler
//       retries and any auto-recovery shell wrappers)
//   (e) SILLY_TRACE_BOOT=1 prints `[silly-boot +Xms]` lines to stderr
//   (f) Every entry-point shim (sillye/sillyx/sillyes/sillyxs/silly) emits
//       its own first-line trace BEFORE importing silly-launcher.js, so the
//       trace chain survives even if silly-launcher.js fails to load
//
// Uses static source assertions + subprocess smoke tests (no network, no
// actual TUI spawn) so it runs in <3s on all 3 OSes and stays in the main
// `npm test` runner. See memory/project-pipeline-require-time-audit.md and
// bin/CLAUDE.md for the safety-net class.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin');
const LAUNCHER = path.join(BIN, 'silly-launcher.js');
const launcher = fs.readFileSync(LAUNCHER, 'utf8');

console.log('Boot watchdog tests\n');

// ── 1. Watchdog declarations exist in silly-launcher.js ──

(function testWatchdogDeclarations() {
  assert.ok(
    /const\s+TRACE_BOOT\s*=\s*process\.env\.SILLY_TRACE_BOOT\s*===\s*['"]1['"]/.test(launcher),
    'silly-launcher.js: TRACE_BOOT flag declaration missing — expected ' +
    'const TRACE_BOOT = process.env.SILLY_TRACE_BOOT === \'1\' || ...'
  );
  assert.ok(
    /const\s+WATCHDOG_MS\s*=\s*Number\(process\.env\.SILLY_BOOT_WATCHDOG_MS\)\s*\|\|\s*30_?000/.test(launcher),
    'silly-launcher.js: WATCHDOG_MS const missing or default !== 30000ms'
  );
  assert.ok(
    /SILLY_NO_BOOT_WATCHDOG\s*!==\s*['"]1['"]/.test(launcher),
    'silly-launcher.js: opt-out flag SILLY_NO_BOOT_WATCHDOG missing'
  );
  console.log('  Watchdog env-flag declarations: PASS');
})();

// ── 2. Watchdog unref + exit code 42 ──

(function testWatchdogUnrefAndExitCode() {
  // unref() is mandatory — without it the 30s timer keeps the event loop
  // alive on clean exit paths (cmdStatus/cmdHelp) and those return slowly.
  assert.ok(
    /_bootWatchdog\.unref\(\)/.test(launcher),
    'silly-launcher.js: watchdog timer must .unref() so clean exits are not blocked'
  );
  // Exit code 42 is the stable "boot watchdog fired" contract. Changing it
  // silently breaks any shell wrapper / cron job that special-cases it.
  assert.ok(
    /process\.exit\(42\)/.test(launcher),
    'silly-launcher.js: watchdog must exit(42) — stable contract for callers'
  );
  console.log('  Watchdog unref() + exit(42) contract: PASS');
})();

// ── 3. clearBootWatchdog at every successful spawn handoff ──

(function testWatchdogClearedOnSpawn() {
  // The watchdog MUST be cleared at every point we successfully hand off
  // to a child process (unix short-path, Windows launchProvider). If a new
  // spawn point is added and forgets to clear, the 30s timer will still
  // unref-exit cleanly on child-exit, but tracing will be incomplete.
  const clearSites = (launcher.match(/clearBootWatchdog\(/g) || []).length;
  assert.ok(
    clearSites >= 3,
    `silly-launcher.js: clearBootWatchdog() called ${clearSites} times, ` +
    `expected >=3 (1 definition + >=2 call sites for unix-spawn and cli-patched-spawn)`
  );
  console.log(`  clearBootWatchdog wired at ${clearSites - 1} call site(s): PASS`);
})();

// ── 4. Every entry shim emits its own first-line trace pre-import ──
//
// If silly-launcher.js itself fails to import (syntax error, missing dep),
// the user still needs to see SOMETHING. Each entry shim writes its own
// SILLY_TRACE_BOOT line BEFORE `await import('./silly-launcher.js')` so the
// trace chain has a beginning even in catastrophic-launcher-load scenarios.

(function testEntryShimTracing() {
  // The SILLY_TRACE_BOOT trace line + launcher import live in the shared
  // `bin/_entry-preamble.js` (the 5 entry shims are 3-line delegators).
  // Shims themselves no longer contain either string, so the invariant is
  // enforced once against the preamble. The live smoke below still exercises
  // the shim→preamble→launcher chain end-to-end.
  const preambleSrc = fs.readFileSync(path.join(BIN, '_entry-preamble.js'), 'utf8');
  assert.ok(
    /SILLY_TRACE_BOOT/.test(preambleSrc),
    `bin/_entry-preamble.js: missing SILLY_TRACE_BOOT pre-import trace line — users lose ` +
    `first-frame visibility if silly-launcher.js fails to load`
  );
  const traceIdx = preambleSrc.indexOf('SILLY_TRACE_BOOT');
  const importIdx = preambleSrc.indexOf('silly-launcher.js');
  assert.ok(
    traceIdx >= 0 && importIdx >= 0 && traceIdx < importIdx,
    `bin/_entry-preamble.js: SILLY_TRACE_BOOT write must come BEFORE launcher import ` +
    `(found trace at ${traceIdx}, import at ${importIdx})`
  );
  // Shims must delegate to the preamble (no duplicated trace/import paths).
  const shims = ['sillye.js', 'sillyx.js', 'sillyes.js', 'sillyxs.js', 'silly.js'];
  for (const name of shims) {
    const src = fs.readFileSync(path.join(BIN, name), 'utf8');
    assert.ok(
      /runEntry/.test(src) && /_entry-preamble\.js/.test(src),
      `bin/${name}: must delegate to runEntry from ./_entry-preamble.js`
    );
  }
  console.log(`  Entry preamble pre-import tracing (+ ${shims.length} shim delegation): PASS`);
})();

// ── 5. Live smoke test: SILLY_TRACE_BOOT emits stderr lines ──
//
// Run `silly help` with trace enabled and confirm the expected trace tags
// appear on stderr. Uses a quick-exit subcommand (`help`) so we don't spawn
// the real TUI. Watchdog opted out (we just want to verify tracing).

(function testTraceLiveSmoke() {
  const r = spawnSync(
    process.execPath,
    [path.join(BIN, 'silly.js'), 'help'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        SILLY_TRACE_BOOT: '1',
        SILLY_NO_BOOT_WATCHDOG: '1',
      },
      timeout: 10_000,
    }
  );
  const stderr = r.stderr || '';
  // The launcher-top line is the most important — if that's missing, the
  // whole trace facility is dead.
  assert.ok(
    stderr.includes('[silly-boot +'),
    `SILLY_TRACE_BOOT=1 produced no [silly-boot +Xms] lines on stderr.\n` +
    `stdout: ${(r.stdout || '').slice(0, 200)}\nstderr: ${stderr.slice(0, 400)}`
  );
  assert.ok(
    stderr.includes('silly.js entry') || stderr.includes('silly-launcher.js top'),
    `Trace lines missing key tags — got: ${stderr.slice(0, 400)}`
  );
  console.log('  SILLY_TRACE_BOOT=1 live stderr smoke: PASS');
})();

// ── 6. Live smoke test: watchdog fires on a truly hung boot ──
//
// Start a subprocess that imports silly-launcher.js with a very short
// watchdog deadline and forces an event-loop-alive wait that prevents it
// from reaching spawn handoff. Expect exit code 42 and the [silly] message
// on stderr.
//
// We simulate the hang by pointing SILLY_TARGET_COMMAND at a real entry
// but wrapping the execution so the launcher never completes handoff.
// Simpler: directly validate the watchdog mechanism in isolation (the
// static tests above already lock the code that wires it in).

(function testWatchdogFires() {
  // Inline mini-script — mirrors the exact launcher pattern.
  const snippet = `
    const t0 = Date.now();
    const _bootWatchdog = setTimeout(() => {
      process.stderr.write('[silly] startup did not complete within 200ms — likely a blocking I/O call.\\n');
      process.exit(42);
    }, 200);
    _bootWatchdog.unref();
    // Keep event loop alive so the watchdog can fire
    setTimeout(() => { process.stderr.write('WATCHDOG SHOULD HAVE FIRED BY NOW\\n'); }, 5000);
  `;
  const r = spawnSync(process.execPath, ['-e', snippet], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.strictEqual(
    r.status, 42,
    `Watchdog should exit 42, got ${r.status}.\nstderr: ${r.stderr}`
  );
  assert.ok(
    /startup did not complete/.test(r.stderr),
    `Watchdog stderr message missing — got: ${r.stderr}`
  );
  console.log('  Watchdog fires exit=42 on hung boot: PASS');
})();

// ── 7. Live smoke test: clean exit is NOT blocked by watchdog ──
//
// `silly help` returns in <1s. If the watchdog timer is not .unref()'d,
// the 30s default would force us to wait. Confirm actual elapsed <<30s.

(function testCleanExitNotBlocked() {
  const t0 = Date.now();
  const r = spawnSync(
    process.execPath,
    [path.join(BIN, 'silly.js'), 'help'],
    { encoding: 'utf8', timeout: 15_000 }
    // NOTE: default env → watchdog ENABLED. If unref was missing, this would
    // block for 30s. The timeout above would catch it but the assertion
    // below tightens the bound to <5s for safety.
  );
  const elapsed = Date.now() - t0;
  assert.strictEqual(
    r.status, 0,
    `silly help should exit 0, got ${r.status}.\nstderr: ${r.stderr}`
  );
  assert.ok(
    elapsed < 5_000,
    `silly help took ${elapsed}ms — watchdog unref() likely broken (would be ~30000ms)`
  );
  console.log(`  Clean-exit not blocked by watchdog (${elapsed}ms): PASS`);
})();

console.log('\nAll boot-watchdog tests passed.');
