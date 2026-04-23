const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Release tarball shape lock. `pipeline/package-release.cjs` copies a fixed
// list of files into the staged tarball. If someone adds a new runtime file
// (e.g. auth-files.sh in Iter 42) but forgets to list it in package-release,
// the tarball silently ships without it and end-user installs break after the
// next release. The release script itself is a run-to-completion side-effect;
// it doesn't export a manifest. This test recovers the manifest by source-
// level extraction (same pattern as launcher-parity / install-mode-parity)
// and asserts:
//
//   (1) Every listed source file actually exists in the working tree.
//   (2) A set of load-bearing entries is present in the list — catches
//       silent dropout during refactors.
//   (3) External scatter-cp references (login.mjs, uninstall.sh,
//       uninstall.ps1) still resolve.
//
// This test does NOT run the release pipeline; it's a shape-only check
// that works in dev environments without a prior `node pipeline/patch.cjs`.

(function main() {
  const root = path.join(__dirname, '..');
  const pkgRelPath = path.join(root, 'pipeline', 'package-release.cjs');
  const src = fs.readFileSync(pkgRelPath, 'utf8');

  // Extract the two array literals. Regex-anchor on the variable name so a
  // refactor that renames them triggers a clear failure rather than silently
  // reading the wrong list.
  function extractArrayLiteral(src, varName) {
    const re = new RegExp(`const\\s+${varName}\\s*=\\s*\\[([^\\]]*)\\]`, 'm');
    const m = src.match(re);
    assert.ok(m, `release-manifest FAIL: could not locate \`const ${varName} = [...]\` in package-release.cjs`);
    return Array.from(m[1].matchAll(/['"]([^'"]+)['"]/g)).map(x => x[1]);
  }

  const launchers = extractArrayLiteral(src, 'launchers');
  const libFromBin = extractArrayLiteral(src, 'libFromBin');

  // (1) Every listed source must exist under bin/.
  for (const name of launchers) {
    const p = path.join(root, 'bin', name);
    assert.ok(fs.existsSync(p),
      `release-manifest FAIL: launcher ${name} listed in package-release.cjs but bin/${name} missing on disk`);
  }
  for (const name of libFromBin) {
    const p = path.join(root, 'bin', name);
    assert.ok(fs.existsSync(p),
      `release-manifest FAIL: libFromBin entry ${name} listed in package-release.cjs but bin/${name} missing on disk`);
  }

  // (2) Load-bearing entries must be present. Adding/removing these requires
  // an explicit test edit — guards against silent dropout during refactors.
  const mustBeInLibFromBin = [
    'auth-files.sh',       // Iter 42 SSoT — silent auth break if dropped
    'silly-auth.js',       // canonical auth constants (Node side)
    'silly-common.sh',     // central bash sourcing hub
    'silly-launcher.js',   // Windows Node launcher
    'upgrade-check.sh',    // auto-upgrade driver
    'install-upgrade-cron.sh', // launchd/cron installer
    'lib-deps.sh',         // ws vendoring helper
  ];
  for (const name of mustBeInLibFromBin) {
    assert.ok(libFromBin.includes(name),
      `release-manifest FAIL: load-bearing file "${name}" not present in package-release.cjs libFromBin — ` +
      `if you're removing it on purpose update this test, otherwise the tarball will ship broken.`);
  }

  const mustBeInLaunchers = ['silly', 'sillye', 'sillyx'];
  for (const name of mustBeInLaunchers) {
    assert.ok(launchers.includes(name),
      `release-manifest FAIL: core launcher "${name}" not present in package-release.cjs launchers list.`);
  }

  // (3) External scatter-cp references. These are hardcoded single-cp lines in
  // package-release.cjs rather than array entries, so we verify by path existence
  // and by confirming the reference still appears in the source (catches
  // accidental deletion).
  const scatterRefs = [
    { src: 'pipeline/login.mjs',         srcPattern: /pipeline['"]\s*,\s*['"]login\.mjs['"]/ },
    { src: 'installer/uninstall.sh',     srcPattern: /installer['"]\s*,\s*['"]uninstall\.sh['"]/ },
    { src: 'installer/uninstall.ps1',    srcPattern: /installer['"]\s*,\s*['"]uninstall\.ps1['"]/ },
    { src: 'deps.json',                  srcPattern: /['"]deps\.json['"]/ },
  ];
  for (const ref of scatterRefs) {
    assert.ok(fs.existsSync(path.join(root, ref.src)),
      `release-manifest FAIL: ${ref.src} referenced by package-release.cjs but missing on disk`);
    assert.ok(ref.srcPattern.test(src),
      `release-manifest FAIL: expected package-release.cjs to reference ${ref.src} (pattern ${ref.srcPattern}) — ` +
      `refactor may have silently dropped it from the stage step.`);
  }

  // (4) libFromBin sort sanity — current file is alphabetical. Not strictly
  // required, but enforcing order makes diffs readable and rejects accidental
  // duplicates. Commented out assertion retained as soft guidance only.
  const dupes = libFromBin.filter((v, i) => libFromBin.indexOf(v) !== i);
  assert.ok(dupes.length === 0,
    `release-manifest FAIL: libFromBin has duplicates: ${dupes.join(', ')}`);

  console.log(`  release-manifest: ${launchers.length} launchers + ${libFromBin.length} libFromBin + ${scatterRefs.length} scatter refs — all resolved`);
  console.log('  release-manifest: PASS');
})();

// Reverse coverage: every real file in bin/ must be handled by
// package-release.cjs — listed in `launchers`, `libFromBin`, or in the
// explicit dev-only allowlist below. This is the *sibling* of the forward
// check above: the forward check catches "listed but missing on disk";
// this catches "present on disk but not shipped" — the silent gap that
// lets someone add bin/new-feature.sh and have the tarball ship broken.
//
// Dev-only allowlist must be explicit and commented. Never leave silent
// exclusions — if you *intend* not to ship a file, the allowlist entry
// documents that intent for the next reviewer.
(function reverseCoverage() {
  const root = path.join(__dirname, '..');
  const binDir = path.join(root, 'bin');
  const pkgRelPath = path.join(root, 'pipeline', 'package-release.cjs');
  const src = fs.readFileSync(pkgRelPath, 'utf8');

  function extractArrayLiteral(src, varName) {
    const re = new RegExp(`const\\s+${varName}\\s*=\\s*\\[([^\\]]*)\\]`, 'm');
    const m = src.match(re);
    assert.ok(m, `release-manifest (reverse) FAIL: could not locate \`const ${varName}\` in package-release.cjs`);
    return new Set(Array.from(m[1].matchAll(/['"]([^'"]+)['"]/g)).map(x => x[1]));
  }

  const launchers = extractArrayLiteral(src, 'launchers');
  const libFromBin = extractArrayLiteral(src, 'libFromBin');

  // Dev-only files in bin/ that intentionally do NOT ship. Each entry needs
  // a one-sentence reason so future-you doesn't have to spelunk.
  const devOnlyAllowlist = new Map([
    ['CLAUDE.md', 'knowledge-graph node; project-internal documentation, not an end-user artifact'],
  ]);

  // Enumerate bin/ — regular files only. Skip directories (e.g. the staged
  // bin/.lib/ tree that package-release itself creates during dev runs) and
  // dotfiles (editor backups, .DS_Store).
  const entries = fs.readdirSync(binDir, { withFileTypes: true });
  const files = entries
    .filter(e => e.isFile() && !e.name.startsWith('.'))
    .map(e => e.name);

  const uncategorized = [];
  for (const name of files) {
    if (launchers.has(name)) continue;
    if (libFromBin.has(name)) continue;
    if (devOnlyAllowlist.has(name)) continue;
    uncategorized.push(name);
  }

  assert.ok(
    uncategorized.length === 0,
    `release-manifest (reverse) FAIL: ${uncategorized.length} file(s) in bin/ are neither shipped nor explicitly dev-only:\n` +
    uncategorized.map(n => `  - bin/${n}`).join('\n') + '\n' +
    `  Fix one of:\n` +
    `    (1) Ship it — add to \`launchers\` or \`libFromBin\` in pipeline/package-release.cjs\n` +
    `    (2) Keep dev-only — add to \`devOnlyAllowlist\` in tests/release-manifest.test.cjs with a reason\n` +
    `    (3) Delete it from bin/ if unused`
  );

  // Allowlist hygiene: every allowlisted file must actually exist (stale
  // entries decay into noise).
  for (const [name, reason] of devOnlyAllowlist) {
    assert.ok(
      fs.existsSync(path.join(binDir, name)),
      `release-manifest (reverse) FAIL: devOnlyAllowlist lists "${name}" (reason: ${reason}) but bin/${name} no longer exists — remove stale entry.`
    );
  }

  console.log(
    `  release-manifest reverse: ${files.length} bin/ files — ` +
    `${[...launchers].filter(n => files.includes(n)).length} launcher + ` +
    `${[...libFromBin].filter(n => files.includes(n)).length} libFromBin + ` +
    `${devOnlyAllowlist.size} dev-only, 0 uncategorized`
  );
  console.log('  release-manifest reverse: PASS');
})();
