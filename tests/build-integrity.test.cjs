// tests/build-integrity.test.cjs — Build-time integrity verification
//
// Tests that the patch pipeline's build guarantees actually hold:
// 1. checkSerialization catches unsafe code patterns
// 2. Sentinel injection replaces all __INJECT_X__ tokens
// 3. Patched binary contains correct provider detection chain
// 4. BARE_INJECT_TOKENS guards match upstream

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { checkSerialization } = require('../pipeline/patches/provider-core.cjs');
const { MATCH, BARE_INJECT_TOKENS, verifyAnchors } = require('../pipeline/match-registry.cjs');
const { base, providers, sorted, fallback } = require('../pipeline/patches/_providers.cjs');

const BUILD_PATH = path.join(__dirname, '..', 'pipeline', 'build', 'cli-patched.js');
const UPSTREAM_PATH = path.join(__dirname, '..', 'pipeline', 'upstream', 'package', 'cli.js');

console.log('Build integrity tests\n');

// ── 1. checkSerialization: must reject bad patterns ──

(function testRejectsRequire() {
  assert.throws(
    () => checkSerialization('const x = require("fs")', 'test'),
    /bare require/,
    'Should reject require()'
  );
  console.log('  checkSerialization rejects require(): PASS');
})();

(function testRejectsModuleScope() {
  assert.throws(
    () => checkSerialization('module.exports = 1', 'test'),
    /module-scope reference/,
    'Should reject module reference'
  );
  assert.throws(
    () => checkSerialization('const d = __dirname', 'test'),
    /module-scope reference/,
    'Should reject __dirname'
  );
  console.log('  checkSerialization rejects module-scope refs: PASS');
})();

(function testRejectsNonNodeImport() {
  assert.throws(
    () => checkSerialization("import('fs')", 'test'),
    /non-node: import/,
    'Should reject non-node: import'
  );
  console.log('  checkSerialization rejects non-node imports: PASS');
})();

(function testAllowsNodeImport() {
  assert.doesNotThrow(
    () => checkSerialization("async function f() { await import('node:fs') }", 'test'),
    'Should allow node: imports'
  );
  console.log('  checkSerialization allows node: imports: PASS');
})();

(function testRejectsSyntaxErrors() {
  assert.throws(
    () => checkSerialization('function f( { }', 'test'),
    /execution verification failed/,
    'Should reject syntax errors'
  );
  console.log('  checkSerialization rejects syntax errors: PASS');
})();

(function testAcceptsValidCode() {
  const validCode = 'function hello() { return 42; }';
  assert.doesNotThrow(
    () => checkSerialization(validCode, 'test'),
    'Should accept valid adapter-style code'
  );
  console.log('  checkSerialization accepts valid code: PASS');
})();

// ── 2. Sentinel injection: no __INJECT_ tokens in build output ──

(function testNoSentinelsInBuild() {
  if (!fs.existsSync(BUILD_PATH)) {
    console.log('  Sentinel injection (build not found, skipping): SKIP');
    return;
  }
  const build = fs.readFileSync(BUILD_PATH, 'utf8');
  const sentinels = build.match(/"__INJECT_[A-Za-z_]+__"/g);
  assert.strictEqual(sentinels, null, `Unreplaced sentinels found in build: ${sentinels}`);
  console.log('  No unreplaced sentinels in build: PASS');
})();

// ── 3. Sentinel injection: verify injected data matches config ──

(function testInjectedDataMatchesConfig() {
  if (!fs.existsSync(BUILD_PATH)) {
    console.log('  Injected data verification (build not found, skipping): SKIP');
    return;
  }
  const build = fs.readFileSync(BUILD_PATH, 'utf8');

  for (const p of providers) {
    if (!p._injectableData) continue;
    for (const [name, data] of Object.entries(p._injectableData)) {
      const serialized = JSON.stringify(data);
      assert.ok(
        build.includes(serialized),
        `${p.key}: injected data for ${name} not found in build (${serialized.slice(0, 80)}...)`
      );
    }
  }
  console.log('  Injected data matches config: PASS');
})();

// ── 4. Provider detection chain in build ──

(function testProviderDetectionChain() {
  if (!fs.existsSync(BUILD_PATH)) {
    console.log('  Provider detection chain (build not found, skipping): SKIP');
    return;
  }
  const build = fs.readFileSync(BUILD_PATH, 'utf8');

  for (const p of sorted) {
    const fragment = `"${p.runtimeId}"`;
    assert.ok(
      build.includes(fragment),
      `Provider runtimeId "${p.runtimeId}" not found in build output`
    );
  }

  const detectionFragment = `S6(process.env.${sorted[0].envKey})?"${sorted[0].runtimeId}"`;
  assert.ok(
    build.includes(detectionFragment),
    `Detection chain fragment not found: ${detectionFragment}`
  );
  console.log('  Provider detection chain present: PASS');
})();

// ── 5. BARE_INJECT_TOKENS guards match upstream ──

(function testBareInjectGuards() {
  if (!fs.existsSync(UPSTREAM_PATH)) {
    console.log('  BARE_INJECT_TOKENS guards (upstream not found, skipping): SKIP');
    return;
  }
  const upstream = fs.readFileSync(UPSTREAM_PATH, 'utf8');

  assert.doesNotThrow(
    () => verifyAnchors(upstream),
    'verifyAnchors should pass against current upstream'
  );

  for (const [name, reSrc, kind] of BARE_INJECT_TOKENS) {
    assert.ok(
      new RegExp(reSrc, 's').test(upstream),
      `Guard for '${name}' (${kind}) does not match upstream`
    );
  }
  console.log('  BARE_INJECT_TOKENS guards match upstream: PASS');
})();

// ── 6. Adapter serialization round-trip ──

(function testAdapterSerialization() {
  const adaptersWithCode = providers.filter(p => p.adapter);
  const baseStr = Object.values(base).map(f => f.toString()).join(';');

  for (const p of adaptersWithCode) {
    let adapterStr = p.adapter.toString();
    if (p._injectableData) {
      for (const [name, data] of Object.entries(p._injectableData)) {
        const sentinel = `"__INJECT_${name}__"`;
        assert.ok(
          adapterStr.includes(sentinel),
          `${p.key}: sentinel ${sentinel} missing from adapter source`
        );
        adapterStr = adapterStr.replace(sentinel, JSON.stringify(data));
      }
    }

    const injectionCode = baseStr + ';' +
      `let _${p.key}Data=null;` +
      p.auth.toString() + ';' +
      adapterStr;

    assert.doesNotThrow(
      () => checkSerialization(injectionCode, `${p.key}-roundtrip`),
      `${p.key}: serialization round-trip failed`
    );
  }
  console.log('  Adapter serialization round-trip: PASS');
})();

// ── 7. MATCH constants present in upstream ──

(function testMatchConstantsInUpstream() {
  if (!fs.existsSync(UPSTREAM_PATH)) {
    console.log('  MATCH constants in upstream (upstream not found, skipping): SKIP');
    return;
  }
  const upstream = fs.readFileSync(UPSTREAM_PATH, 'utf8');

  const criticalKeys = ['DETECT', 'INJECT', 'RESOLVE', 'FAMILY', 'CONSTRUCTOR', 'VERSION'];
  for (const key of criticalKeys) {
    assert.ok(
      upstream.includes(MATCH[key]),
      `MATCH.${key} not found in upstream: "${MATCH[key].slice(0, 60)}..."`
    );
  }
  console.log('  Critical MATCH constants present in upstream: PASS');
})();

console.log('\nAll build integrity tests passed.');
