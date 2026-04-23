// tests/settings-pollution.test.cjs — Settings.json cross-provider pollution
//
// Locks three invariants, end-to-end:
//   (1) bin/clean-claude-settings.js module — strips only foreign slugs,
//       preserves every other field, idempotent on clean files.
//   (2) Patch 57 in build — W8 (updateSettingsForSource) has a non-firstParty
//       guard that drops `model` from update objects.
//   (3) CLAUDE firstParty path is byte-identical for non-model writes.
//
// No network. Uses os.tmpdir() sandbox; never writes real settings files.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  cleanSettingsFile,
  cleanClaudeSettings,
  autoHealOnLaunch,
  isForeignSlug,
  FOREIGN_PREFIXES,
} = require('../bin/clean-claude-settings.cjs');

const BUILD_PATH = path.join(__dirname, '..', 'pipeline', 'build', 'cli-patched.js');

console.log('Settings pollution tests\n');

// ── 1. isForeignSlug: strict allowlist semantics ──

(function testForeignPrefixList() {
  // Foreign: must be stripped
  for (const slug of [
    'gpt-5.4',
    'gpt-5.2-codex',
    'gpt-4o',
    'o1-mini',
    'o3',
    'o4-preview',
    'codex-latest',
    'gemini-2.5',
    'grok-4',
    'GPT-5.4', // case-insensitive
    '  gpt-5.4  ', // trimmed
  ]) {
    assert.strictEqual(isForeignSlug(slug), true, `should flag "${slug}" as foreign`);
  }

  // Claude-compatible: never stripped
  for (const slug of [
    'opus',
    'sonnet',
    'haiku',
    'sonnet[1m]',
    'claude-opus-4-7',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5',
    'claude-opus-4-6',
    'opus[1m]',
    'default',
    'inherit',
  ]) {
    assert.strictEqual(isForeignSlug(slug), false, `should NOT flag "${slug}" as foreign`);
  }

  // Non-string / empty: never stripped
  assert.strictEqual(isForeignSlug(null), false);
  assert.strictEqual(isForeignSlug(undefined), false);
  assert.strictEqual(isForeignSlug(''), false);
  assert.strictEqual(isForeignSlug(42), false);
  assert.strictEqual(isForeignSlug({}), false);
  console.log('  isForeignSlug allowlist semantics: PASS');
})();

// ── 2. cleanSettingsFile: real-file roundtrip ──

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'silly-pollution-'));
}

(function testStripsForeignModelPreservesRest() {
  const dir = tmpdir();
  const file = path.join(dir, 'settings.json');
  const original = {
    model: 'gpt-5.4',
    effortLevel: 'xhigh',
    enabledPlugins: { 'foo@1.0.0': true },
    permissions: { allow: ['Bash(git:*)'], deny: [] },
    skipDangerousModePermissionPrompt: true,
  };
  fs.writeFileSync(file, JSON.stringify(original, null, 2));
  const res = cleanSettingsFile(file);
  assert.strictEqual(res.changed, true, 'should report changed');
  assert.strictEqual(res.strippedModel, 'gpt-5.4');

  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(after, 'model'), false, 'model should be removed');
  // Every other top-level field survives unmodified
  assert.strictEqual(after.effortLevel, 'xhigh');
  assert.deepStrictEqual(after.enabledPlugins, { 'foo@1.0.0': true });
  assert.deepStrictEqual(after.permissions, { allow: ['Bash(git:*)'], deny: [] });
  assert.strictEqual(after.skipDangerousModePermissionPrompt, true);
  assert.strictEqual(Object.keys(after).length, 4);
  console.log('  cleanSettingsFile strips foreign model + preserves siblings: PASS');
})();

(function testLeavesClaudeModelUntouched() {
  const dir = tmpdir();
  const file = path.join(dir, 'settings.json');
  const original = {
    model: 'claude-opus-4-7',
    permissions: { allow: [], deny: [] },
  };
  fs.writeFileSync(file, JSON.stringify(original, null, 2));
  const res = cleanSettingsFile(file);
  assert.strictEqual(res.changed, false, 'claude slug must not trigger change');
  assert.strictEqual(res.reason, 'model-is-claude-compatible');
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(after.model, 'claude-opus-4-7');
  console.log('  cleanSettingsFile leaves Claude model untouched: PASS');
})();

(function testIdempotentOnMissingOrCleanFile() {
  const dir = tmpdir();
  const absent = path.join(dir, 'nope.json');
  const res1 = cleanSettingsFile(absent);
  assert.strictEqual(res1.changed, false);
  assert.strictEqual(res1.reason, 'no-settings-file');

  const present = path.join(dir, 'settings.json');
  fs.writeFileSync(present, JSON.stringify({ permissions: {} }, null, 2));
  const res2 = cleanSettingsFile(present);
  assert.strictEqual(res2.changed, false);
  assert.strictEqual(res2.reason, 'no-model-field');

  // Malformed JSON: don't crash, just report
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{not json');
  const res3 = cleanSettingsFile(bad);
  assert.strictEqual(res3.changed, false);
  assert.strictEqual(res3.reason, 'malformed-json');

  console.log('  cleanSettingsFile idempotent / tolerant: PASS');
})();

(function testIdempotentAfterStrip() {
  const dir = tmpdir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ model: 'gpt-5.4', effortLevel: 'x' }, null, 2));
  const res1 = cleanSettingsFile(file);
  assert.strictEqual(res1.changed, true);
  const res2 = cleanSettingsFile(file); // second pass
  assert.strictEqual(res2.changed, false, 'second pass must be a no-op');
  assert.strictEqual(res2.reason, 'no-model-field');
  console.log('  cleanSettingsFile idempotent across repeated runs: PASS');
})();

// ── 3. cleanClaudeSettings: multi-path + sandbox isolation ──

(function testMultiPathCleanup() {
  const fakeHome = tmpdir();
  const fakeData = tmpdir();
  const claudeDir = path.join(fakeHome, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const claudeSettings = path.join(claudeDir, 'settings.json');
  const sillySettings = path.join(fakeData, 'settings.json');
  fs.writeFileSync(claudeSettings, JSON.stringify({ model: 'gpt-5.4', a: 1 }));
  fs.writeFileSync(sillySettings, JSON.stringify({ model: 'o1-mini', b: 2 }));

  const results = cleanClaudeSettings({ home: fakeHome, sillyData: fakeData });
  assert.strictEqual(results.length, 2);
  assert.ok(results.every(r => r.changed), 'both paths should change');

  const after1 = JSON.parse(fs.readFileSync(claudeSettings, 'utf8'));
  const after2 = JSON.parse(fs.readFileSync(sillySettings, 'utf8'));
  assert.ok(!('model' in after1));
  assert.ok(!('model' in after2));
  assert.strictEqual(after1.a, 1);
  assert.strictEqual(after2.b, 2);
  console.log('  cleanClaudeSettings multi-path sweep: PASS');
})();

// ── 4. autoHealOnLaunch: 24h dedup ──

(function testAutoHealDedup() {
  const fakeHome = tmpdir();
  const fakeData = tmpdir();
  const claudeDir = path.join(fakeHome, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const claudeSettings = path.join(claudeDir, 'settings.json');
  fs.writeFileSync(claudeSettings, JSON.stringify({ model: 'gpt-5.4', a: 1 }));

  const r1 = autoHealOnLaunch({ home: fakeHome, sillyData: fakeData });
  assert.strictEqual(r1.skipped, false, 'first call should run');
  assert.ok(r1.results.some(r => r.changed), 'first call should strip');

  // Put pollution back, but second call within 24h must skip
  fs.writeFileSync(claudeSettings, JSON.stringify({ model: 'gpt-5.4', a: 1 }));
  const r2 = autoHealOnLaunch({ home: fakeHome, sillyData: fakeData });
  assert.strictEqual(r2.skipped, true, 'second call within 24h should skip');

  // Still polluted because we skipped
  const after = JSON.parse(fs.readFileSync(claudeSettings, 'utf8'));
  assert.strictEqual(after.model, 'gpt-5.4');
  console.log('  autoHealOnLaunch 24h dedup: PASS');
})();

// ── 5. Patch 57 in build: write-guard injected at W8 entry ──

(function testPatch57Injected() {
  if (!fs.existsSync(BUILD_PATH)) {
    console.log('  Patch 57 W8 write-guard (build not found, skipping): SKIP');
    return;
  }
  const build = fs.readFileSync(BUILD_PATH, 'utf8');
  const idx = build.indexOf('function W8(H,_){');
  assert.ok(idx !== -1, 'W8 (updateSettingsForSource) not found in build');
  const body = build.substring(idx, idx + 500);

  assert.ok(
    body.includes('"model"in _'),
    'Patch 57: W8 guard missing "model"in _ predicate — foreign-provider model writes will leak'
  );
  assert.ok(
    body.includes('typeof uq==="function"') && body.includes('uq()!=="firstParty"'),
    'Patch 57: W8 guard missing provider check — firstParty path must be unaffected'
  );
  assert.ok(
    body.includes('if(_k!=="model")'),
    'Patch 57: W8 guard must strip only the model key from _, not the whole update'
  );
  console.log('  Patch 57 W8 write-guard injected at entry: PASS');
})();

// ── 6. Patch 57 safety: firstParty short-circuits before mutation ──

(function testPatch57FirstPartyBypass() {
  if (!fs.existsSync(BUILD_PATH)) {
    console.log('  Patch 57 firstParty bypass (build not found, skipping): SKIP');
    return;
  }
  const build = fs.readFileSync(BUILD_PATH, 'utf8');
  const idx = build.indexOf('function W8(H,_){');
  const body = build.substring(idx, idx + 500);

  // The guard MUST be a conjunction that includes uq()!=="firstParty".
  // If that's dropped, Claude's own model writes would be stripped — a Track-1
  // purity violation. Lock the full predicate shape.
  assert.ok(
    /"model"in _&&typeof uq==="function"&&uq\(\)!=="firstParty"/.test(body),
    'Patch 57: guard predicate must be model-key-present AND non-firstParty; missing either breaks Track-1 purity or lets pollution through'
  );
  console.log('  Patch 57 guard predicate locked (Track-1 safe): PASS');
})();

console.log('\n  All settings-pollution tests PASSED');
