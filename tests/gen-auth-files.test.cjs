const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { extractArray, extractKeychainRel, render } = require('../pipeline/gen-auth-files.cjs');

// Regenerator idempotency: rendering from the canonical source
// (bin/silly-auth.js) must produce byte-identical output to the
// committed bash shim (bin/auth-files.sh). If this fails, either
// silly-auth.js changed without regenerating, or auth-files.sh
// was hand-edited. Fix: `node pipeline/gen-auth-files.cjs`.

(function main() {
  const root = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(root, 'bin', 'silly-auth.js'), 'utf8');
  const expected = render(
    extractArray(src, 'codex'),
    extractArray(src, 'claude'),
    extractKeychainRel(src)
  );
  const committedPath = path.join(root, 'bin', 'auth-files.sh');
  assert.ok(
    fs.existsSync(committedPath),
    'bin/auth-files.sh missing — run `node pipeline/gen-auth-files.cjs`'
  );
  const committed = fs.readFileSync(committedPath, 'utf8');
  assert.strictEqual(
    committed, expected,
    'bin/auth-files.sh out of sync with bin/silly-auth.js — run `node pipeline/gen-auth-files.cjs`'
  );

  // Sanity: the committed shim must define the four constants the bash
  // launchers rely on. Guards against the generator regressing without
  // the launcher-parity test also catching it.
  for (const name of ['CODEX_AUTH', 'CODEX_OAUTH', 'CLAUDE_OAUTH', 'CLAUDE_CRED']) {
    assert.ok(
      new RegExp(`^${name}=`, 'm').test(committed),
      `bin/auth-files.sh missing ${name} assignment`
    );
  }

  console.log('  gen-auth-files: PASS');
})();

// CLI contract for `gen-auth-files.cjs --check` — readonly verification mode
// used by CI / pre-commit. The exit-code triple (0 synced, 1 drift, 2 unknown
// arg) is the durable interface; silent regressions would break downstream
// workflows that grep stderr or branch on $?. Drift simulation uses stash/
// restore with try/finally to guarantee the committed shim is byte-identical
// on test exit even if an assertion throws.
(function checkCliContract() {
  const root = path.join(__dirname, '..');
  const cli = path.join(root, 'pipeline', 'gen-auth-files.cjs');
  const shim = path.join(root, 'bin', 'auth-files.sh');
  const originalBytes = fs.readFileSync(shim);

  const run = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });

  try {
    // (1) synced → exit 0, stdout announces OK
    const synced = run('--check');
    assert.strictEqual(synced.status, 0,
      `--check on synced shim: expected exit 0, got ${synced.status}\n` +
      `stdout: ${synced.stdout}\nstderr: ${synced.stderr}`);
    assert.ok(/matches canonical source/.test(synced.stdout),
      `--check synced stdout missing "matches canonical source": ${synced.stdout}`);

    // (2) drifted → exit 1, stderr carries fix hint
    fs.writeFileSync(shim, 'CODEX_AUTH="codex-BROKEN.json"\n');
    const drifted = run('--check');
    assert.strictEqual(drifted.status, 1,
      `--check on drifted shim: expected exit 1, got ${drifted.status}\n` +
      `stdout: ${drifted.stdout}\nstderr: ${drifted.stderr}`);
    assert.ok(/out of sync/.test(drifted.stderr),
      `--check drifted stderr missing "out of sync": ${drifted.stderr}`);
    assert.ok(/node pipeline\/gen-auth-files\.cjs/.test(drifted.stderr),
      `--check drifted stderr missing fix command: ${drifted.stderr}`);

    // (3) unknown arg → exit 2
    const unknown = run('--nope');
    assert.strictEqual(unknown.status, 2,
      `--nope: expected exit 2, got ${unknown.status}\n` +
      `stdout: ${unknown.stdout}\nstderr: ${unknown.stderr}`);
    assert.ok(/unknown argument/.test(unknown.stderr),
      `unknown-arg stderr missing "unknown argument": ${unknown.stderr}`);
  } finally {
    // Restore byte-identical under all code paths (assertion throws, child
    // process crash, etc). If this finally itself fails the test run will be
    // loud rather than silent-corrupt.
    fs.writeFileSync(shim, originalBytes);
  }

  // Post-restore safety net: shim must be byte-identical to what we saw on entry.
  const restored = fs.readFileSync(shim);
  assert.ok(
    Buffer.compare(originalBytes, restored) === 0,
    'CRITICAL: shim not restored after --check cli contract test — manual fix: `node pipeline/gen-auth-files.cjs`'
  );

  console.log('  gen-auth-files --check CLI contract: PASS');
})();
