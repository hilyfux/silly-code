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
const { MATCH, BARE_INJECT_TOKENS, verifyAnchors, latestVarmap } = require('../pipeline/match-registry.cjs');
const { base, providers, sorted, fallback } = require('../pipeline/patches/_providers.cjs');
const { findNativeBinary, stageFromLocalBunBinary } = require('../pipeline/bun-extract.cjs');

const BUILD_PATH = path.join(__dirname, '..', 'pipeline', 'build', 'cli-patched.js');
const UPSTREAM_PATH = path.join(__dirname, '..', 'pipeline', 'upstream', 'package', 'cli.js');

// Read each 12MB artifact once; downstream tests reuse the cached string.
const build = fs.existsSync(BUILD_PATH) ? fs.readFileSync(BUILD_PATH, 'utf8') : null;
const upstream = fs.existsSync(UPSTREAM_PATH) ? fs.readFileSync(UPSTREAM_PATH, 'utf8') : null;

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
  if (!build) {
    console.log('  Sentinel injection (build not found, skipping): SKIP');
    return;
  }
  const sentinels = build.match(/"__INJECT_[A-Za-z_]+__"/g);
  assert.strictEqual(sentinels, null, `Unreplaced sentinels found in build: ${sentinels}`);
  console.log('  No unreplaced sentinels in build: PASS');
})();

// ── Cross-platform: no baked Linux build-runner URLs survive into output ──
// Upstream bun-bundles import.meta.url as literal `file:///home/runner/...`
// strings that, on Windows, crash node:url's getPathFromURLWin32 at module
// load (ERR_INVALID_FILE_URL_PATH — see memory project-dist-layout-gotchas).
// pipeline/patches/cross-platform.cjs rewrites every such call to __filename
// (or `require` for createRequire). This test catches:
//   (a) upstream introducing a NEW baked URL we haven't patched yet, AND
//   (b) cross-platform patch silently skipping due to upstream regex drift.
(function testNoBakedLinuxRunnerUrls() {
  if (!build) {
    console.log('  Baked runner URL sweep (build not found, skipping): SKIP');
    return;
  }
  const baked = build.match(/file:\/\/\/home\/runner\/[^"]+/g) || [];
  assert.strictEqual(
    baked.length, 0,
    `Baked Linux runner URLs survived patching (Windows will crash):\n  ${baked.join('\n  ')}\n` +
    `Add the URL substring to BAKED_URLS in pipeline/patches/cross-platform.cjs`
  );
  console.log('  No baked file:///home/runner/ URLs in build: PASS');
})();

// ── 3. Sentinel injection: verify injected data matches config ──

(function testInjectedDataMatchesConfig() {
  if (!build) {
    console.log('  Injected data verification (build not found, skipping): SKIP');
    return;
  }

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
  if (!build) {
    console.log('  Provider detection chain (build not found, skipping): SKIP');
    return;
  }

  for (const p of sorted) {
    const fragment = `"${p.runtimeId}"`;
    assert.ok(
      build.includes(fragment),
      `Provider runtimeId "${p.runtimeId}" not found in build output`
    );
  }

  // env-truthy helper name (S6 in ≤2.1.112, EH in 2.1.114+) tracks upstream
  // renames via varmap so no manual edit is needed on release bumps.
  const latestMap = latestVarmap(path.join(__dirname, '..', 'pipeline'));
  const envTruthy = latestMap
    ? (JSON.parse(fs.readFileSync(latestMap, 'utf8')).isEnvTruthy_in_getAPIProvider || 'EH')
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
  if (!upstream) {
    console.log('  BARE_INJECT_TOKENS guards (upstream not found, skipping): SKIP');
    return;
  }

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
  if (!upstream) {
    console.log('  MATCH constants in upstream (upstream not found, skipping): SKIP');
    return;
  }

  const criticalKeys = ['DETECT', 'INJECT', 'CONSTRUCTOR', 'VERSION'];
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
  if (!build) {
    console.log('  Patch 48 1h cache allowlist (build not found, skipping): SKIP');
    return;
  }

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
  if (!build) {
    console.log('  Patch 56 cross-provider guard (build not found, skipping): SKIP');
    return;
  }

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
  if (!build) {
    console.log('  Patch 53 menu parity (build not found, skipping): SKIP');
    return;
  }

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

// ── 10b. ci-upgrade.cjs require-main guard (Iter 80) ──
//
// pipeline/ci-upgrade.cjs is a top-level async IIFE that runs the full
// unattended upgrade when invoked. The Iter 80 guard `if (require.main !== module) return;`
// inside that IIFE is the only defense against `require('./pipeline/ci-upgrade.cjs')`
// detonating at import time (Iter 72-73 incident — see
// memory/project-ci-upgrade-no-require-guard.md). Lock it at build-integrity level so
// any future diff removing or weakening the guard trips CI red.

(function testCiUpgradeRequireGuard() {
  const ciUpgradePath = path.join(__dirname, '..', 'pipeline', 'ci-upgrade.cjs');
  const src = fs.readFileSync(ciUpgradePath, 'utf8');
  assert.ok(
    /\(async function main\(\)\s*\{[\s\S]{0,600}?if\s*\(\s*require\.main\s*!==\s*module\s*\)\s*return\s*;/.test(src),
    'ci-upgrade.cjs: require-main guard missing inside async main() IIFE — ' +
    '`require("./pipeline/ci-upgrade.cjs")` would trigger a full unattended upgrade at import time. ' +
    'Restore `if (require.main !== module) return;` as the first statement of the IIFE.'
  );
  console.log('  ci-upgrade require-main guard present: PASS');

  // Iter 82: dry-run env flag. v1 short-circuits the full upgrade body after
  // version diagnostics; useful for inspecting what a real run would do without
  // touching disk. The assertion locks three things so a future refactor can't
  // accidentally cripple it: (a) the env var is read into a module-level const,
  // (b) the DRY_RUN branch exists inside main(), (c) it calls process.exit(0)
  // so CI sees a clean no-op.
  assert.ok(
    /const\s+DRY_RUN\s*=\s*process\.env\.SILLY_CI_UPGRADE_DRY_RUN\s*===\s*['"]1['"]/.test(src),
    'ci-upgrade.cjs: DRY_RUN const declaration missing — expected `const DRY_RUN = process.env.SILLY_CI_UPGRADE_DRY_RUN === \'1\'` at module scope.'
  );
  assert.ok(
    /if\s*\(\s*DRY_RUN\s*\)\s*\{[\s\S]{0,800}?process\.exit\(0\)/.test(src),
    'ci-upgrade.cjs: DRY_RUN branch missing or does not exit(0) — dry-run must short-circuit before any mutation stage.'
  );
  console.log('  ci-upgrade dry-run flag present: PASS');

  assert.ok(
    /SILLY_CI_UPGRADE_LOCAL_BINARY/.test(src) && /stageUpstreamFromLocalBinary/.test(src),
    'ci-upgrade.cjs: local native binary staging hook missing — offline upgrade probes would require npm/network access.'
  );
  console.log('  ci-upgrade local-native staging hook present: PASS');
})();

// ── 10c. Pipeline entry-point classification — auto-discovery (Iter 83 → Iter 98) ──
//
// Iter 83 spread the Iter 80 discipline as a hardcoded list of 5 entry-point
// scripts. Iter 97 added audit-doc-refs.cjs. Iter 98 closes the silent-add
// gap by switching to auto-discovery: every `pipeline/*.cjs` MUST classify
// into exactly one of three classes (per memory/project-pipeline-require-time-audit.md):
//
//   Class A — Entry-point with NEGATIVE guard: `if (require.main !== module) return;`
//             at top. Side-effecting body would detonate on stray require().
//   Class B — Library-and-CLI with POSITIVE wrapper: `if (require.main === module) { ... }`
//             at bottom. Library use is harmless; CLI use runs the wrapper.
//   Class C — Pure library: only `module.exports = {...}` declarations + functions.
//             Allowlisted explicitly because we can't statically prove "no SE".
//
// New unclassified file → fail with a hint to pick a class. Closes the
// "added a new entry-point but forgot to add the guard / forgot to add to
// the test list" silent-failure path that the Iter 97 audit-doc-refs
// addition revealed (the test wouldn't have caught a missing guard if I'd
// forgotten to extend the hardcoded list).

(function testPipelineFileClassification() {
  const pipelineDir = path.join(__dirname, '..', 'pipeline');
  const NEG_GUARD = /if\s*\(\s*require\.main\s*!==\s*module\s*\)\s*return\s*;?/;
  const POS_WRAPPER = /if\s*\(\s*require\.main\s*===\s*module\s*\)\s*\{/;

  // Class C allowlist — pure library files with no top-level side effects.
  // Adding to this list is a deliberate decision: the file is required by
  // multiple consumers and adding a guard would break them. Verify by
  // grepping consumers + reading the file end-to-end before extending.
  const PURE_LIBRARY = new Set(['match-registry.cjs']);

  const files = fs.readdirSync(pipelineDir)
    .filter(f => f.endsWith('.cjs'))
    .sort();

  const classified = { A: [], B: [], C: [], unknown: [] };
  for (const name of files) {
    const src = fs.readFileSync(path.join(pipelineDir, name), 'utf8');
    if (NEG_GUARD.test(src)) {
      classified.A.push(name);
    } else if (POS_WRAPPER.test(src)) {
      classified.B.push(name);
    } else if (PURE_LIBRARY.has(name)) {
      classified.C.push(name);
    } else {
      classified.unknown.push(name);
    }
  }

  assert.deepStrictEqual(
    classified.unknown, [],
    `pipeline/*.cjs files unclassified into A/B/C:\n` +
    classified.unknown.map(n => `    ${n}`).join('\n') + `\n` +
    `Each must be one of:\n` +
    `  Class A — entry-point: add \`if (require.main !== module) return;\` near the top.\n` +
    `  Class B — library+CLI: wrap CLI body in \`if (require.main === module) { ... }\` at bottom.\n` +
    `  Class C — pure library: confirm no top-level SE, then add to PURE_LIBRARY allowlist in this test.\n` +
    `See memory/project-pipeline-require-time-audit.md for the three-class rule.`
  );

  console.log(
    `  pipeline/*.cjs classification (${files.length} files): ` +
    `A=${classified.A.length} (${classified.A.join(',')}) | ` +
    `B=${classified.B.length} (${classified.B.join(',')}) | ` +
    `C=${classified.C.length} (${classified.C.join(',')}): PASS`
  );
})();

// Iter 87: forecloses the Iter 86 orphan-test class. Every tests/*.test.cjs
// must be wired into `package.json:scripts.test`, otherwise assertions accrue
// silently outside CI. compat.test.cjs is the canary — bin/silly-launcher.js's
// cmdDoctor spawns it as a production adapter-compat probe, so an orphaned
// state means Windows doctor integrity is untested on main.

(function testAllTestsInRunner() {
  const testsDir = __dirname;
  const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.cjs'));
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const testScript = pkg.scripts && pkg.scripts.test;
  assert.ok(testScript, 'package.json:scripts.test missing');
  const missing = files.filter(f => !testScript.includes(`tests/${f}`));
  assert.deepStrictEqual(
    missing, [],
    `Orphan test files not wired into npm test: ${missing.join(', ')} — ` +
    `append \`&& node tests/<name>\` to package.json:scripts.test. See ` +
    `memory/project-tests-orphan-audit.md for the Iter 86 audit rule.`
  );
  console.log(`  all ${files.length} tests/*.test.cjs wired into npm test: PASS`);
})();

// Iter 93: forecloses the Iter 91 placeholder-rot class. docs/harness-architecture.md
// must contain zero `Iter [single-capital-letter]` tokens — those are write-time
// placeholders ("Iter N", "Iter X") that survive if the author forgets to back-fill
// the concrete iter/commit. The pattern excludes "Iter 40" (digit) and "Iterate"
// (lowercase after capital I), so legitimate references survive. See
// memory/project-harness-section6-freshness.md for the Iter 91 catch + Iter 92
// docs-wide sweep that classified 3 noisy-grep hits as legitimate prose.

(function testHarnessDocNoPlaceholders() {
  const p = path.join(__dirname, '..', 'docs', 'harness-architecture.md');
  if (!fs.existsSync(p)) {
    console.log('  harness-architecture.md not found, skipping placeholder check: SKIP');
    return;
  }
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const hits = [];
  const pattern = /\bIter [A-Z]\b/;
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) hits.push(`${i + 1}: ${lines[i].trim().slice(0, 120)}`);
  }
  assert.deepStrictEqual(
    hits, [],
    `docs/harness-architecture.md contains placeholder-rot tokens (Iter <capital-letter>):\n` +
    hits.map(h => `    ${h}`).join('\n') + `\n` +
    `Replace with concrete iter number + commit hash. Example fix (Iter 91):\n` +
    `  "tested Iter N" → "tested 2026-04-20 (commit \`6e15231\`) and reverted (\`e01a648\`)"\n` +
    `See memory/project-harness-section6-freshness.md for the rule.`
  );
  console.log(`  harness-architecture.md placeholder-free (\\bIter [A-Z]\\b): PASS`);
})();

// ── 10d. CI Windows test coverage parity ──
//
// `.github/workflows/ci.yml` runs a 3-OS matrix (ubuntu/macos/windows) but only a
// subset of tests execute on Windows. The user-curated PURE_NODE_TESTS list names
// the ten tests/*.test.cjs files with no bash/launchctl/security dependency — i.e.
// files that SHOULD run on Windows because nothing in them needs a POSIX shell.
//
// If CI is ever extended to run these on Windows, great. If one is deliberately
// skipped, it must be named in SKIPPED_ALLOWLIST with a reason comment so the
// rationale survives. Unlisted + unrun = silent Windows coverage hole, which is
// exactly the class of regression that the Iter 100 Windows cascade (see
// memory/project-dist-layout-gotchas + project-windows-baked-runner-urls) showed
// is expensive to debug after the fact.
//
// Parsing strategy: no YAML dep. We scan ci.yml for every `node tests/<file>`
// token and treat the set-union across the job as "what CI can run". If a step
// is guarded by `if: runner.os != 'Windows'`, its tests are collected as
// unix-only and excluded from the Windows-reachable set. This is deliberately
// conservative — false-positive noise (test listed as Windows-ok when actually
// skipped) would cause a spurious fail, so we err toward allowing skip and only
// catch the truly unlisted case.

(function testCiWindowsCoverageParity() {
  const ciPath = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');
  if (!fs.existsSync(ciPath)) {
    console.log('  CI Windows coverage parity (ci.yml not found, skipping): SKIP');
    return;
  }
  const ciYml = fs.readFileSync(ciPath, 'utf8');

  // Pure-Node tests that SHOULD run on Windows unless explicitly allowlisted.
  // Scoped to the set R-D research flagged — these have no bash/launchctl/
  // security/POSIX-only dependency and exist to catch cross-platform drift.
  const PURE_NODE_TESTS = [
    'tests/launcher-parity.test.cjs',
    'tests/install-mode-parity.test.cjs',
    'tests/release-manifest.test.cjs',
    'tests/varmap-parity.test.cjs',
    'tests/match-token-drift.test.cjs',
    'tests/provider-flag-parity.test.cjs',
    'tests/gen-auth-files.test.cjs',
    'tests/ci-upgrade-kg.test.cjs',
    'tests/agent-core.test.cjs',
    'tests/build-invariants.test.cjs',
  ];

  // Any test in PURE_NODE_TESTS that's deliberately NOT run on Windows must
  // appear here with a reason comment explaining why. Current baseline locks
  // the pre-expansion CI state: ci.yml only runs 4 tests cross-platform (base +
  // schema + providers + compat + build-integrity, all pure Node). The ten
  // below are reachable but not wired into the matrix. Removing an entry here
  // after adding it to ci.yml tightens coverage; adding a new entry (without a
  // reason) signals deliberate skipping. Keeping this explicit prevents silent
  // regressions — any NEW pure-Node test added to PURE_NODE_TESTS without a CI
  // step and without allowlisting will fail build-integrity immediately.
  const SKIPPED_ALLOWLIST = new Map([
    ['tests/launcher-parity.test.cjs',    'pre-expansion CI baseline — pure Node, wire when CI grows'],
    ['tests/install-mode-parity.test.cjs','pre-expansion CI baseline — pure Node, wire when CI grows'],
    ['tests/release-manifest.test.cjs',   'pre-expansion CI baseline — pure Node, wire when CI grows'],
    ['tests/varmap-parity.test.cjs',      'pre-expansion CI baseline — pure Node, wire when CI grows'],
    ['tests/match-token-drift.test.cjs',  'pre-expansion CI baseline — pure Node, wire when CI grows'],
    ['tests/provider-flag-parity.test.cjs','pre-expansion CI baseline — pure Node, wire when CI grows'],
    ['tests/gen-auth-files.test.cjs',     'pre-expansion CI baseline — pure Node, wire when CI grows'],
    ['tests/ci-upgrade-kg.test.cjs',      'pre-expansion CI baseline — pure Node, wire when CI grows'],
    ['tests/agent-core.test.cjs',         'pre-expansion CI baseline — pure Node, wire when CI grows'],
    ['tests/build-invariants.test.cjs',   'pre-expansion CI baseline — pure Node, wire when CI grows'],
  ]);

  // Split ci.yml into lines + walk to find every `node tests/<file>.test.cjs`
  // reference, tagging each with whether its enclosing step is Unix-only.
  const lines = ciYml.split('\n');
  const windowsReachable = new Set();  // tests the Windows runner will execute
  const unixOnly = new Set();          // tests behind `if: runner.os != 'Windows'`

  let stepIsUnixOnly = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Step boundary — `- name:` or `- uses:` resets the guard scope.
    if (/^\s*-\s+(name|uses):/.test(line)) {
      stepIsUnixOnly = false;
      // Look ahead up to 5 lines for an `if:` that excludes Windows.
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        if (/^\s*-\s+(name|uses):/.test(lines[j])) break; // next step
        if (/^\s*if:\s*.*runner\.os\s*!=\s*['"]Windows['"]/.test(lines[j])) {
          stepIsUnixOnly = true;
          break;
        }
      }
    }
    const matches = line.matchAll(/node\s+(tests\/[\w-]+\.test\.cjs)/g);
    for (const m of matches) {
      const testFile = m[1];
      if (stepIsUnixOnly) unixOnly.add(testFile);
      else windowsReachable.add(testFile);
    }
  }

  // Find pure-Node tests that CI doesn't run on Windows and aren't allowlisted.
  const gaps = PURE_NODE_TESTS.filter(t =>
    !windowsReachable.has(t) && !SKIPPED_ALLOWLIST.has(t)
  );

  assert.deepStrictEqual(
    gaps, [],
    `CI Windows test coverage gap — pure-Node tests with no Windows run:\n` +
    gaps.map(t => `    ${t}`).join('\n') + `\n` +
    `Either add them to .github/workflows/ci.yml's cross-platform step, OR\n` +
    `add an entry to SKIPPED_ALLOWLIST in this test with a reason explaining\n` +
    `why the test genuinely cannot run on Windows.\n` +
    `(Windows-only coverage holes are exactly the class of bug that produced\n` +
    ` the Iter 100 cascade — see memory/project-dist-layout-gotchas.)`
  );

  console.log(
    `  CI Windows coverage parity (${PURE_NODE_TESTS.length} pure-Node tests, ` +
    `${windowsReachable.size} reachable on Windows, ${SKIPPED_ALLOWLIST.size} allowlisted): PASS`
  );
})();

// ── 10e. Windows cron label parity invariant ──
//
// bin/install-upgrade-cron.sh (macOS branch) registers a launchd agent under
// the fixed label `com.silly-code.upgrade-check`. bin/silly-launcher.js's
// cmdCron is the Windows counterpart — today a helpful stub that explains
// Task Scheduler isn't wired yet. When Task Scheduler support DOES land, the
// Windows side must reuse the exact same label string so `silly cron status`
// on Windows can discover a job scheduled on the same user's macOS machine
// (shared home dir, dual-boot, NFS-mounted HOME, etc.) and so log/plist names
// stay symmetric across platforms.
//
// This test locks the invariant two-sided: (1) the bash installer must keep
// the exact label string, and (2) silly-launcher.js must either reference it
// (Task Scheduler landed) OR carry a comment acknowledging the pending parity
// so a future contributor can't introduce a DIFFERENT Windows label by accident.

(function testWindowsCronLabelParity() {
  const shPath = path.join(__dirname, '..', 'bin', 'install-upgrade-cron.sh');
  const launcherPath = path.join(__dirname, '..', 'bin', 'silly-launcher.js');
  if (!fs.existsSync(shPath) || !fs.existsSync(launcherPath)) {
    console.log('  Windows cron label parity (launcher or installer not found, skipping): SKIP');
    return;
  }
  const shSrc = fs.readFileSync(shPath, 'utf8');
  const launcherSrc = fs.readFileSync(launcherPath, 'utf8');

  const LABEL = 'com.silly-code.upgrade-check';
  const shHits = (shSrc.match(new RegExp(LABEL.replace(/\./g, '\\.'), 'g')) || []).length;
  assert.ok(
    shHits >= 1,
    `bin/install-upgrade-cron.sh: launchd label "${LABEL}" not found — ` +
    `macOS cron registration relies on this exact string. If the label has been renamed, ` +
    `update this test + bin/silly-launcher.js's cmdCron to match.`
  );

  const launcherHasLabel = launcherSrc.includes(LABEL);
  const launcherHasPendingMarker =
    /task\s*scheduler/i.test(launcherSrc) &&
    /(not\s*yet\s*supported|pending|not\s*implemented)/i.test(launcherSrc);

  assert.ok(
    launcherHasLabel || launcherHasPendingMarker,
    `bin/silly-launcher.js::cmdCron neither references the launchd label "${LABEL}" ` +
    `nor acknowledges Windows Task Scheduler as a pending port. One of the two ` +
    `must be true — otherwise the cron label parity invariant is silent and a ` +
    `future Task Scheduler PR could use a DIFFERENT label, breaking symmetric ` +
    `status/logs across a shared HOME / dual-boot setup.`
  );

  const mode = launcherHasLabel ? 'label-present' : 'pending-marker';
  console.log(`  Windows cron label parity invariant (${mode}): PASS`);
})();

// ── 11. Patch 55b — picker Current-model cross-provider filter ──

(function testPickerCurrentModelFilter() {
  if (!build) {
    console.log('  Patch 55b picker filter (build not found, skipping): SKIP');
    return;
  }
  assert.ok(
    build.includes('uq()==="firstParty"&&q&&q.startsWith("gpt-")') &&
    build.includes('uq()==="openai"&&q&&!q.startsWith("gpt-")'),
    'Patch 55b: /model picker Current-model filter missing — cross-provider model would appear as current'
  );
  console.log('  Patch 55b picker current-model filter present: PASS');
})();

// ── 10d. bun-extract native-binary staging helpers ──
//
// Upstream 2.1.113+ ships per-platform native binaries. The upgrade harness
// must work on all three supported OS families and must also be able to
// analyze a locally-installed native binary when npm/network access is not
// available in the automation runner.

(function testBunExtractNativeBinaryHelpers() {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bun-extract-helper-test-'));
  try {
    const pkgDir = path.join(tmp, 'package');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'claude.exe'), 'fake');
    assert.strictEqual(
      findNativeBinary(pkgDir),
      path.join(pkgDir, 'claude.exe'),
      'bun-extract must discover win32 package/claude.exe, not only package/claude'
    );

    fs.writeFileSync(path.join(pkgDir, 'claude'), 'fake');
    assert.strictEqual(
      findNativeBinary(pkgDir),
      path.join(pkgDir, 'claude'),
      'bun-extract should prefer extensionless package/claude when present'
    );

    assert.strictEqual(typeof stageFromLocalBunBinary, 'function',
      'bun-extract must export stageFromLocalBunBinary for offline local-native upgrade probes');
    assert.throws(
      () => stageFromLocalBunBinary(path.join(tmp, 'missing-claude'), path.join(tmp, 'out'), { version: '2.1.999' }),
      /local native binary not found/,
      'stageFromLocalBunBinary must fail fast on a missing explicit binary path'
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('  bun-extract native-binary helpers present: PASS');
})();

console.log('\nAll build integrity tests passed.');
