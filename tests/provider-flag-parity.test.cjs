const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Guard the provider-env-flag dispatch chain across THREE surfaces:
//
//   bin/sillyx (bash)             export CLAUDE_CODE_USE_OPENAI=1
//   bin/silly-launcher.js (Node)  providers.sillyx.env
//   pipeline/patches/providers/openai.cjs (adapter)  envKey
//
// If any one of these drifts, the launcher exports a no-op env var and the
// user falls through to Claude silently. This is exactly the kind of silent
// degradation we ban — no hidden fallbacks. The adapter config is the single
// source of truth; the dispatch surfaces must match it.
//
// Note: in the open-source install model, installer/install.ps1 no longer
// dispatches env vars — the .cmd wrappers just `node bin\<cmd>.js` and the
// JS launcher (silly-launcher.js) sets the env via its providers table.
// Source-install removes the install-time dispatch hashtable surface entirely.

const root = path.join(__dirname, '..');

// ── Single source of truth: adapter envKey per provider ──
const providerFiles = [
  'pipeline/patches/providers/openai.cjs',
  'pipeline/patches/providers/claude.cjs',
];
const adapterConfigs = {};
for (const rel of providerFiles) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  // Grab the module.exports object literal, then parse its key + envKey.
  const exp = src.match(/module\.exports\s*=\s*\{([\s\S]*)\n\};/);
  assert.ok(exp, `${rel}: module.exports block not found`);
  const body = exp[1];
  const keyM = body.match(/^\s*key:\s*'([^']+)'/m);
  const envM = body.match(/^\s*envKey:\s*(?:'([A-Z_]+)'|(null))/m);
  assert.ok(keyM && envM, `${rel}: could not parse key/envKey in exports`);
  adapterConfigs[keyM[1]] = envM[1] || null;
}
assert.ok(adapterConfigs.openai === 'CLAUDE_CODE_USE_OPENAI', 'openai adapter envKey drifted');
assert.ok(adapterConfigs.claude === null, 'claude adapter envKey must be null (default/fallback)');

// ── Provider-launcher mapping that must agree everywhere ──
// sillyx → openai; sillye → claude (no envKey). sillyxs/sillyes are
// --dangerously-skip-permissions wrappers around sillyx/sillye.
const expected = {
  sillyx: 'CLAUDE_CODE_USE_OPENAI',
  sillyxs: 'CLAUDE_CODE_USE_OPENAI',
  sillye: null,
  sillyes: null,
};

// ── Surface 1: bin/sillyx (bash launcher) ──
const sillyxSh = fs.readFileSync(path.join(root, 'bin', 'sillyx'), 'utf8');
const bashExport = sillyxSh.match(/^export\s+(CLAUDE_CODE_USE_[A-Z_]+)=1/m);
assert.ok(bashExport, 'bin/sillyx: no `export CLAUDE_CODE_USE_* =1` line');
assert.strictEqual(
  bashExport[1], expected.sillyx,
  `bin/sillyx exports ${bashExport[1]} but adapter expects ${expected.sillyx}`
);

// bin/sillye must NOT export any CLAUDE_CODE_USE_* (it's the default/fallback)
const sillyeSh = fs.readFileSync(path.join(root, 'bin', 'sillye'), 'utf8');
assert.ok(
  !/^export\s+CLAUDE_CODE_USE_/m.test(sillyeSh),
  'bin/sillye must not export CLAUDE_CODE_USE_* — it is the default Claude path'
);

// ── Surface 2: bin/silly-launcher.js (Windows Node entrypoint) ──
const launcherJs = fs.readFileSync(path.join(root, 'bin', 'silly-launcher.js'), 'utf8');
const providerTable = launcherJs.match(/const providers = \{([\s\S]*?)\};/);
assert.ok(providerTable, 'silly-launcher.js: providers table missing');
function launcherEnv(cmd) {
  const re = new RegExp(`${cmd}:\\s*\\{[^}]*env:\\s*(?:'([A-Z_]+)'|(null))`);
  const m = providerTable[1].match(re);
  assert.ok(m, `silly-launcher.js providers.${cmd}.env not found`);
  return m[1] || null;
}
assert.strictEqual(launcherEnv('sillyx'), expected.sillyx, 'silly-launcher sillyx.env drifted');
assert.strictEqual(launcherEnv('sillye'), expected.sillye, 'silly-launcher sillye.env drifted');

// ── Adapter ↔ dispatch cross-check: every non-null dispatch value must be
// a declared adapter envKey. This catches the reverse direction — someone
// adds a new launcher flag that no adapter listens for. ──
const allDispatchEnvs = new Set(
  [expected.sillyx, expected.sillye, expected.sillyxs, expected.sillyes].filter(Boolean)
);
const allAdapterEnvs = new Set(Object.values(adapterConfigs).filter(Boolean));
for (const e of allDispatchEnvs) {
  assert.ok(
    allAdapterEnvs.has(e),
    `Dispatch surfaces reference ${e} but no adapter declares it as envKey`
  );
}
for (const e of allAdapterEnvs) {
  assert.ok(
    allDispatchEnvs.has(e),
    `Adapter declares envKey ${e} but no launcher dispatches it — orphaned`
  );
}

console.log('  provider-flag-parity: PASS');
