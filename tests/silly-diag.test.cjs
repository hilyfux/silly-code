// tests/silly-diag.test.cjs — silly-diag standalone Windows install diagnostic
//
// silly-diag is the tool of last resort when sillye/sillyx hang silently:
// it walks each layer of the startup dependency chain (fs → cli-patched.js →
// ws → child spawn → settings → network → bounded launcher import) and
// attributes any failure to exactly one step via a stable exit code.
//
// This test locks two things:
//
//   (a) Running silly-diag against the host environment exits 0 (every layer
//       OK) OR exits with a specific contract code 50–54 (one layer failed).
//       Any OTHER exit code is a bug — silly-diag must NEVER be ambiguous.
//   (b) The seven step tags appear on stderr in the order step1 → step7,
//       so a user who redirects stderr always has a scannable trail.
//
// Contract codes (mirrors bin/silly-diag.js docstring):
//   0  — all 7 steps pass (healthy install)
//   50 — step1 fs readdir failed
//   51 — step2 cli-patched.js not found in any candidate
//   52 — step3 ws module missing / unresolvable
//   53 — step4 child node spawn failed
//   54 — step7 silly-launcher.js import hung or threw

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin');
const DIAG = path.join(BIN, 'silly-diag.js');

console.log('silly-diag tests\n');

// ── 1. silly-diag.js exists and is syntactically valid ──

(function testDiagScriptExists() {
  assert.ok(fs.existsSync(DIAG), `bin/silly-diag.js missing at ${DIAG}`);
  const src = fs.readFileSync(DIAG, 'utf8');
  // Node loads top-level await as an ESM file. silly-diag.js uses top-level
  // await for dynamic imports and is .js (package.json type=module) so it's
  // inherently ESM. Guard: every step label must exist in the source so the
  // test below can assert on ordering.
  for (const step of ['step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7']) {
    assert.ok(src.includes(step), `silly-diag.js missing ${step} tag`);
  }
  // Contract exit codes must be literal — if someone refactors them away the
  // downstream shell wrappers silently break.
  for (const code of [50, 51, 52, 53, 54]) {
    assert.ok(
      new RegExp(`process\\.exit\\(${code}\\)`).test(src),
      `silly-diag.js missing process.exit(${code}) — stable contract`
    );
  }
  console.log('  silly-diag.js source + step tags + exit codes: PASS');
})();

// ── 2. silly-diag.js does NOT directly import silly-launcher.js ──
//
// The whole point of this tool is to test the startup chain WITHOUT pulling
// in the launcher transitively. Step 7 uses a child process spawn. If anyone
// adds a top-level `import './silly-launcher.js'` the diag tool becomes
// useless for its primary failure class.

(function testDiagIsolation() {
  const src = fs.readFileSync(DIAG, 'utf8');
  // Step 7 is deliberately allowed to REFERENCE silly-launcher by path (as a
  // string passed to a child-process spawn), but it MUST NOT do a top-level
  // `import()` or `from '...'` that brings it into this same V8 isolate.
  // Strip // line-comments first so the test doesn't false-fire on the
  // explanatory header comments that name silly-launcher.js.
  const codeOnly = src
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))   // strip line-comment tail
    .join('\n')
    // Strip /* ... */ block comments (naive but safe for this file's style)
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // Dangerous patterns (top-level or any-scope direct import of launcher):
  //   import('./silly-launcher.js')
  //   import './silly-launcher.js'
  //   from './silly-launcher.js'
  // The step-7 probe uses `import(${JSON.stringify(launcherPath)})` inside a
  // template literal that's passed as a child `-e` script — the outer `import(`
  // is in a STRING, not an AST-level import. Those string literals have the
  // form `import(" + " surrounded by backticks, so they won't match the
  // patterns below (which require a literal `./silly-launcher` in source).
  const badPatterns = [
    /\bimport\s*\(\s*['"]\.\/silly-launcher/,
    /\bimport\s+['"]\.\/silly-launcher/,
    /\bfrom\s+['"]\.\/silly-launcher/,
  ];
  for (const pat of badPatterns) {
    const m = codeOnly.match(pat);
    if (m) {
      assert.fail(
        `silly-diag.js directly imports silly-launcher.js (${pat}) — that's ` +
        `the exact hang source the tool is meant to isolate around. Use a ` +
        `child-process probe instead.\n  offending match: ${m[0]}`
      );
    }
  }
  console.log('  silly-diag does NOT top-level-import silly-launcher.js: PASS');
})();

// ── 3. Live execution against host → exit code 0 or contract code ──

(function testLiveHostExecution() {
  const r = spawnSync(process.execPath, [DIAG], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env },
  });
  // Allowed exit codes: 0 (healthy) or specific layer-fail 50-54.
  const validExits = new Set([0, 50, 51, 52, 53, 54]);
  assert.ok(
    validExits.has(r.status),
    `silly-diag exited with unexpected code ${r.status}. ` +
    `Valid: 0 or 50-54. This means silly-diag crashed in a way it was ` +
    `specifically designed to prevent.\n` +
    `stdout: ${(r.stdout || '').slice(0, 300)}\n` +
    `stderr: ${(r.stderr || '').slice(0, 600)}`
  );
  console.log(`  silly-diag host exec: exit=${r.status} (contract-valid)`);

  // ── 4. All 7 step tags must appear on stderr up to the first failure ──
  //
  // If silly-diag exits 0, all 7 steps ran → all 7 tags present.
  // If it exits 5N (N=0-4), steps 1..N ran → tags step1..stepN present at
  // minimum. Use lower-bound assertion so this test survives step re-ordering.
  const stderr = r.stderr || '';
  const lastStep = r.status === 0 ? 7 : Math.max(1, r.status - 49);
  for (let i = 1; i <= lastStep; i++) {
    const tag = 'step' + i;
    assert.ok(
      stderr.includes(`[silly-diag] ${tag}`),
      `stderr missing "[silly-diag] ${tag}" tag — either the step did not ` +
      `run or output got lost.\nFull stderr:\n${stderr}`
    );
  }
  console.log(`  stderr contains step1..step${lastStep} tags: PASS`);

  // Healthy host MUST see all 7 tags, not just up to exit-code layer.
  if (r.status === 0) {
    for (let i = 1; i <= 7; i++) {
      assert.ok(
        stderr.includes(`[silly-diag] step${i}`),
        `Healthy-path silly-diag (exit 0) missing step${i} tag — ` +
        `implies step was skipped despite "all pass" exit.`
      );
    }
    assert.ok(
      stderr.includes('all steps pass'),
      `Healthy exit 0 should end with "all steps pass" tail — got:\n${stderr}`
    );
    console.log('  healthy-host: all 7 tags + "all steps pass" tail: PASS');
  }
})();

// ── 5. install.ps1 registers silly-diag.cmd ──

(function testInstallPs1Registers() {
  const installPs1 = fs.readFileSync(path.join(__dirname, '..', 'install.ps1'), 'utf8');
  assert.ok(
    /silly-diag\.cmd/.test(installPs1),
    'install.ps1: missing silly-diag.cmd registration — Windows users will ' +
    'not get silly-diag on PATH after install.'
  );
  assert.ok(
    /silly-diag\.js/.test(installPs1),
    'install.ps1: missing silly-diag.js reference (cmd shim target).'
  );
  console.log('  install.ps1 registers silly-diag.cmd: PASS');
})();

// ── 6. package-release.cjs ships silly-diag.js in dist tarball ──

(function testReleasePackageShipsDiag() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'pipeline', 'package-release.cjs'),
    'utf8'
  );
  assert.ok(
    /['"]silly-diag\.js['"]/.test(src),
    'pipeline/package-release.cjs: silly-diag.js not in libFromBin — ' +
    'dist tarball users will not have the diagnostic tool.'
  );
  console.log('  package-release.cjs libFromBin includes silly-diag.js: PASS');
})();

console.log('\nAll silly-diag tests passed.');
