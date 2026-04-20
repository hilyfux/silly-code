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

  // The env-truthy helper name (S6 in ≤2.1.112, EH in 2.1.114+) is resolved
  // from the upstream varmap so this test tracks upstream renames without
  // a manual edit each release.
  const varmapDir = path.join(__dirname, '..', 'pipeline');
  const versionedMaps = fs.readdirSync(varmapDir)
    .filter(f => /^varmap-.+\.json$/.test(f))
    .sort();
  const latestMap = versionedMaps[versionedMaps.length - 1];
  const envTruthy = latestMap
    ? (JSON.parse(fs.readFileSync(path.join(varmapDir, latestMap), 'utf8')).isEnvTruthy_in_getAPIProvider || 'EH')
    : 'EH';
  const detectionFragment = `${envTruthy}(process.env.${sorted[0].envKey})?"${sorted[0].runtimeId}"`;
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

// ── 8. Patch 48 — 1h prompt cache allowlist wildcard survives in build ──

(function testPromptCache1hAllowlist() {
  if (!fs.existsSync(BUILD_PATH)) {
    console.log('  Patch 48 1h cache allowlist (build not found, skipping): SKIP');
    return;
  }
  const build = fs.readFileSync(BUILD_PATH, 'utf8');

  assert.ok(
    build.includes('"tengu_prompt_cache_1h_config",{allowlist:["*"]}'),
    'Patch 48: allowlist must be ["*"] (wildcard) to match every querySource'
  );

  assert.ok(
    !build.includes('"tengu_prompt_cache_1h_config",{allowlist:["repl_main_thread*","sdk","auto_mode"]}'),
    'Patch 48: upstream default allowlist must NOT survive — would silently drop 28 querySources to 5min'
  );

  const td7Idx = build.indexOf('function td7(');
  assert.ok(td7Idx !== -1, 'td7 (allowlist matcher) not found in build');
  const td7 = build.substring(td7Idx, td7Idx + 500);
  assert.ok(
    td7.includes('q.endsWith("*")'),
    'td7 wildcard semantics changed — rename or refactor. Re-anchor patch 48.'
  );
  console.log('  Patch 48 1h cache allowlist wildcard present: PASS');
})();

// ── 9. Patch 56 — cross-provider persisted-model guard in db() ──

(function testCrossProviderModelGuard() {
  if (!fs.existsSync(BUILD_PATH)) {
    console.log('  Patch 56 cross-provider guard (build not found, skipping): SKIP');
    return;
  }
  const build = fs.readFileSync(BUILD_PATH, 'utf8');

  const dbIdx = build.indexOf('function db()');
  assert.ok(dbIdx !== -1, 'db() not found in build — banner model resolver missing');
  const dbBody = build.substring(dbIdx, dbIdx + 700);

  assert.ok(
    dbBody.includes('typeof uq==="function"'),
    'Patch 56: db() missing provider-parity guard — cross-provider model will leak into banner'
  );
  assert.ok(
    dbBody.includes('_isGpt='),
    'Patch 56: gpt-prefix detector missing from db() guard'
  );
  assert.ok(
    dbBody.includes('_p==="firstParty"&&_isGpt') && dbBody.includes('_p==="openai"&&!_isGpt'),
    'Patch 56: symmetric cross-provider filter missing (both directions required)'
  );
  console.log('  Patch 56 cross-provider model guard present: PASS');
})();

// ── 10. Patch 53 family — menu parity across provider branches ──

(function testMenuParity() {
  if (!fs.existsSync(BUILD_PATH)) {
    console.log('  Patch 53 menu parity (build not found, skipping): SKIP');
    return;
  }
  const build = fs.readFileSync(BUILD_PATH, 'utf8');

  const z85Idx = build.indexOf('function z85(');
  assert.ok(z85Idx !== -1, 'z85() (model menu renderer) not found in build');

  // Walk braces to find the end of z85.
  let depth = 0, started = false, z85End = -1;
  for (let k = z85Idx; k < z85Idx + 10000; k++) {
    const c = build[k];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) { z85End = k + 1; break; } }
  }
  assert.ok(z85End !== -1, 'could not parse z85() body');
  const z85 = build.substring(z85Idx, z85End);

  // 53: openai early-return with exactly 8 GPT items + no claude leak
  assert.ok(
    z85.startsWith('function z85(H=!1){if(typeof uq==="function"&&uq()==="openai")return ['),
    'Patch 53: openai early-return missing from z85 entry'
  );
  const openaiCount = (z85.match(/value:"gpt-5\./g) || []).length;
  assert.ok(openaiCount >= 8, `Patch 53: openai GPT list shrank (${openaiCount} items, expected 8+)`);
  // Extract only the openai GPT list (between [ and the matching ]) and
  // assert no claude-* value leaks into it. The _sO47 helper below does
  // reference "claude-opus-4-7" but that is outside the list.
  const listStart = z85.indexOf('uq()==="openai")return [');
  const listOpen = z85.indexOf('[', listStart);
  let bracketDepth = 0, listEnd = -1;
  for (let k = listOpen; k < z85.length; k++) {
    if (z85[k] === '[') bracketDepth++;
    else if (z85[k] === ']') { bracketDepth--; if (bracketDepth === 0) { listEnd = k + 1; break; } }
  }
  const openaiList = z85.substring(listOpen, listEnd);
  assert.ok(
    !/value:"claude-/.test(openaiList),
    'Patch 53: claude model leaked into openai menu branch'
  );

  // 53-family: _sO47 wrapper must be defined and applied at every firstParty return site
  assert.ok(z85.includes('var _sO47=function(x)'), 'Patch 53: _sO47 helper not defined in z85');
  // 53c/53d/53e/53f wrap 4 return sites — each produces one `_sO47(` call.
  const sO47Calls = (z85.match(/_sO47\(/g) || []).length;
  assert.ok(
    sO47Calls >= 4,
    `Patch 53 family: _sO47 applied at only ${sO47Calls} return sites, expected 4 (53c/d/e/f)`
  );

  // No unwrapped return that pushes l$7 or r$7 at a firstParty branch
  assert.ok(
    !/(?<!_sO47\()return \$\.push\(l\$7\),\$/.test(z85),
    'Patch 53c: found unwrapped "return $.push(l$7),$" — Opus 4.7 will not appear in Hq sub branch'
  );
  assert.ok(
    !/(?<!_sO47\()return T\.push\(l\$7\),T/.test(z85),
    'Patch 53d: found unwrapped "return T.push(l$7),T" — Opus 4.7 will not appear in Hq default branch'
  );
  console.log('  Patch 53 family menu parity present: PASS');
})();

// ── 11. Patch 55b — picker Current-model cross-provider filter ──

(function testPickerCurrentModelFilter() {
  if (!fs.existsSync(BUILD_PATH)) {
    console.log('  Patch 55b picker filter (build not found, skipping): SKIP');
    return;
  }
  const build = fs.readFileSync(BUILD_PATH, 'utf8');
  assert.ok(
    build.includes('uq()==="firstParty"&&q&&q.startsWith("gpt-")') &&
    build.includes('uq()==="openai"&&q&&!q.startsWith("gpt-")'),
    'Patch 55b: /model picker Current-model filter missing — cross-provider model would appear as current'
  );
  console.log('  Patch 55b picker current-model filter present: PASS');
})();

console.log('\nAll build integrity tests passed.');
