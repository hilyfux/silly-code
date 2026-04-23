const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Guard the dual-stack drift between bin/silly-common.sh (bash launchers)
// and bin/silly-auth.js (Node launcher). Both hardcode the same auth filenames
// because adapters are string-injected and can't share modules. If someone
// renames a file in one side and forgets the other, login detection breaks
// silently for half the launcher surface.

(async function main() {
  const root = path.join(__dirname, '..');
  const commonSh = fs.readFileSync(path.join(root, 'bin', 'silly-common.sh'), 'utf8');

  // Extract bash constants
  function bashVar(name) {
    const m = commonSh.match(new RegExp(`^${name}="([^"]+)"`, 'm'));
    assert.ok(m, `silly-common.sh missing ${name}`);
    return m[1];
  }
  const bash = {
    codexAuth: bashVar('CODEX_AUTH'),
    codexOauth: bashVar('CODEX_OAUTH'),
    claudeOauth: bashVar('CLAUDE_OAUTH'),
  };

  // Load Node ESM source as text (can't `require` ESM in a .cjs test) and
  // extract the two arrays via regex. Keys are known; values are string
  // literals inside a JS array. Quoted the hard way so we don't depend on a
  // full JS parser in the test.
  const authSrc = fs.readFileSync(path.join(root, 'bin', 'silly-auth.js'), 'utf8');
  function pickList(key) {
    const m = authSrc.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`));
    assert.ok(m, `silly-auth.js AUTH_FILES.${key} not found`);
    return Array.from(m[1].matchAll(/['"]([^'"]+)['"]/g)).map(x => x[1]);
  }
  const node = { codex: pickList('codex'), claude: pickList('claude') };
  assert.ok(node.codex.length > 0, 'AUTH_FILES.codex empty');
  assert.ok(node.claude.length > 0, 'AUTH_FILES.claude empty');

  // Parity assertions
  assert.ok(
    node.codex.includes(bash.codexAuth),
    `bash CODEX_AUTH=${bash.codexAuth} not in Node AUTH_FILES.codex=${JSON.stringify(node.codex)}`
  );
  assert.ok(
    node.codex.includes(bash.codexOauth),
    `bash CODEX_OAUTH=${bash.codexOauth} not in Node AUTH_FILES.codex=${JSON.stringify(node.codex)}`
  );
  assert.ok(
    node.claude.includes(bash.claudeOauth),
    `bash CLAUDE_OAUTH=${bash.claudeOauth} not in Node AUTH_FILES.claude=${JSON.stringify(node.claude)}`
  );

  // Reverse: every Node-side filename must also be covered by bash.
  const bashCodexSet = new Set([bash.codexAuth, bash.codexOauth]);
  for (const f of node.codex) {
    assert.ok(
      bashCodexSet.has(f),
      `Node AUTH_FILES.codex has ${f} but silly-common.sh CODEX_AUTH/CODEX_OAUTH do not cover it`
    );
  }
  const bashClaudeSet = new Set([bash.claudeOauth]);
  for (const f of node.claude) {
    assert.ok(
      bashClaudeSet.has(f),
      `Node AUTH_FILES.claude has ${f} but silly-common.sh CLAUDE_OAUTH does not cover it`
    );
  }

  // Adapter side: the OpenAI adapter writes refreshed tokens with this basename.
  // If the basename drifts here, refresh-on-launch will fail silently — launchers
  // keep finding the stale -oauth.json and never notice the -auth.json update.
  const openaiSrc = fs.readFileSync(path.join(root, 'pipeline/patches/providers/openai.cjs'), 'utf8');
  for (const f of node.codex) {
    assert.ok(
      openaiSrc.includes(f),
      `openai.cjs adapter does not reference ${f} — bash/Node expect it but adapter won't produce it`
    );
  }

  // Claude macOS keychain path — upstream Claude Code stores OAuth here and both
  // the bash side (CLAUDE_CRED) and Node side (CLAUDE_MACOS_KEYCHAIN) encode
  // `~/.claude/.credentials.json` independently. Keep them in lockstep.
  const bashCred = bashVar('CLAUDE_CRED');
  // Normalize bash value: strip $HOME/ prefix so we compare basenames+relpath.
  const bashCredRel = bashCred.replace(/^\$HOME\//, '').replace(/^\$\{HOME\}\//, '');
  const nodeCredM = authSrc.match(/CLAUDE_MACOS_KEYCHAIN\s*=\s*path\.join\(os\.homedir\(\)\s*,([^)]+)\)/);
  assert.ok(nodeCredM, 'silly-auth.js CLAUDE_MACOS_KEYCHAIN definition not found');
  const nodeCredParts = Array.from(nodeCredM[1].matchAll(/'([^']+)'/g)).map(x => x[1]);
  const nodeCredRel = nodeCredParts.join('/');
  assert.strictEqual(
    nodeCredRel, bashCredRel,
    `bash CLAUDE_CRED=${bashCred} (rel=${bashCredRel}) vs Node CLAUDE_MACOS_KEYCHAIN rel=${nodeCredRel}`
  );

  // Keychain symmetric login contract — dormant cross-platform regression.
  // bin/sillye (bash) probes the macOS Keychain via `security find-generic-password`
  // when no file-based token is present. bin/silly-launcher.js currently runs only
  // on Windows (see the `if (!isWindows)` guard at silly-launcher.js:80), so
  // bin/silly-auth.js::authState never needs Keychain knowledge in production today.
  // If that platform guard is ever removed (so Node launcher serves macOS), the
  // Node path must grow an equivalent Keychain probe or macOS users with only a
  // Keychain entry would appear logged-out forever. This test locks the
  // invariant: if bash checks Keychain AND Node launcher loses its Windows-only
  // guard, silly-auth.js must reference Keychain detection.
  {
    const bashSillye = fs.readFileSync(path.join(root, 'bin', 'sillye'), 'utf8');
    const bashHasKeychain = /security find-generic-password/.test(bashSillye);
    const nodeHasKeychain = /find-generic-password|Keychain|keychain/.test(authSrc);

    if (bashHasKeychain && !nodeHasKeychain) {
      const nodeLauncher = fs.readFileSync(path.join(root, 'bin', 'silly-launcher.js'), 'utf8');
      const isWindowsGuarded = /if\s*\(\s*!\s*isWindows\s*\)|process\.platform\s*===\s*['"]win32['"]/.test(nodeLauncher);
      assert.ok(
        isWindowsGuarded,
        'Node launcher (bin/silly-launcher.js) claims cross-platform but bin/silly-auth.js lacks Keychain detection that bin/sillye uses. ' +
        'Either add a Keychain probe to silly-auth.js::authState, or keep the `if (!isWindows)` / win32 platform guard in silly-launcher.js ' +
        'so non-Windows macOS users continue going through bash sillye (the Keychain-aware path).'
      );
    }
    console.log('  keychain symmetric login contract: PASS');
  }

  console.log('  launcher-parity: PASS');
})().catch(err => {
  console.error('  launcher-parity: FAIL', err.message);
  process.exit(1);
});
