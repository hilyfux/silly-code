const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Source-level parity: silly-launcher.js (Windows Node launcher) and
// silly-common.sh (macOS/Linux bash launchers) independently reimplement
// PATCHED-path + install-mode resolution. If the two drift, one platform
// picks the wrong binary silently. Lock the shared contract here.
//
// Contract:
//   dist mode: <root>/versions/ contains ≥1 non-hidden file; PATCHED = last-sorted entry
//   dev mode:  no valid versions/ entry → PATCHED = <root>/pipeline/build/cli-patched.js
//
// This is a string-presence / regex-shape test; it does not simulate
// filesystems. Its purpose is to catch drift in the *implementation shape*
// (someone renames "versions" on one side, forgets to filter dotfiles,
// picks first-sorted instead of last, etc.). The real end-to-end behavior
// is covered by CI's 3-OS matrix.

(function main() {
  const root = path.join(__dirname, '..');
  const launcherJs = fs.readFileSync(path.join(root, 'bin', 'silly-launcher.js'), 'utf8');
  const commonSh = fs.readFileSync(path.join(root, 'bin', 'silly-common.sh'), 'utf8');

  const checks = [
    ['both reference versions/ directory as dist marker', () =>
      /readdirSync\(path\.join\(root,\s*['"]versions['"]\)\)/.test(launcherJs) &&
      commonSh.includes('"$root/versions"')],

    ['both exclude hidden files when listing versions/', () =>
      /\.filter\(f\s*=>\s*!f\.startsWith\(['"]\.['"]\)\)/.test(launcherJs) &&
      /grep -v '\^\\\.'/.test(commonSh)],

    ['both sort ascending and pick last entry (= latest version)', () =>
      /\.sort\(\)/.test(launcherJs) &&
      launcherJs.includes('versions[versions.length - 1]') &&
      commonSh.includes('sort | tail -n1')],

    ['both require the chosen file to exist before declaring dist mode', () =>
      /fs\.existsSync\(patched\)/.test(launcherJs) &&
      /\[ -f "\$root\/versions\/\$latest" \]/.test(commonSh)],

    ['both fall back to pipeline/build/cli-patched.js in dev mode', () =>
      launcherJs.includes("'pipeline'") &&
      launcherJs.includes("'build'") &&
      launcherJs.includes("'cli-patched.js'") &&
      commonSh.includes('pipeline/build/cli-patched.js')],

    ['silly-launcher.js honors SILLY_INSTALL_DIR for root override (Windows .cmd wrapper contract)', () =>
      /process\.env\.SILLY_INSTALL_DIR/.test(launcherJs)],

    ['bash launchers derive ROOT_DIR from $(cd dirname BASH_SOURCE .. && pwd)', () => {
      const silly = fs.readFileSync(path.join(root, 'bin', 'silly'), 'utf8');
      const sillyx = fs.readFileSync(path.join(root, 'bin', 'sillyx'), 'utf8');
      const sillye = fs.readFileSync(path.join(root, 'bin', 'sillye'), 'utf8');
      const pat = /ROOT_DIR="\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\." && pwd\)"/;
      return pat.test(silly) && pat.test(sillyx) && pat.test(sillye);
    }],

    // Harness §6 hotspot #1: both doctor implementations must flag the
    // ambiguous "versions/ AND pipeline/ both present" layout so users can
    // disentangle dev vs dist copies without guesswork.
    ['bash `silly doctor` warns when versions/ and pipeline/ both exist', () => {
      const silly = fs.readFileSync(path.join(root, 'bin', 'silly'), 'utf8');
      return /Layout ambiguous/.test(silly) &&
        /\[ -d "\$ROOT_DIR\/versions" \] && \[ -d "\$ROOT_DIR\/pipeline" \]/.test(silly);
    }],

    ['Node `silly doctor` warns when versions/ and pipeline/ both exist', () =>
      /Layout ambiguous/.test(launcherJs) &&
      /hasVersions.*hasPipeline/s.test(launcherJs)],
  ];

  for (const [desc, fn] of checks) {
    assert.ok(fn(), `install-mode-parity FAIL: ${desc}`);
  }

  console.log('  install-mode-parity: PASS');
})();
