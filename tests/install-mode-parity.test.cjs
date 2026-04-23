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

    // Runtime deps (ws) — open-source install model places ws at
    // pipeline/build/node_modules/ws so Node's default module resolution
    // walks straight from cli-patched.js's directory and finds it. No
    // NODE_PATH gymnastics. Legacy dist installs still honor NODE_PATH
    // via silly-common.sh + silly-launcher.js (back-compat for users who
    // still have a tarball install on disk); install.{sh,ps1} no longer
    // create that layout but the runtime can still consume it.

    // install.{sh,ps1} both install ws into pipeline/build/node_modules
    // so the standard Node resolver walks straight to it.
    ['install.sh installs ws under pipeline/build/node_modules', () => {
      const sh = fs.readFileSync(path.join(root, 'installer', 'install.sh'), 'utf8');
      return /pipeline\/build\/node_modules\/ws/.test(sh) &&
        /npm install ws/.test(sh);
    }],

    ['install.ps1 installs ws under pipeline\\build\\node_modules', () => {
      const ps1 = fs.readFileSync(path.join(root, 'installer', 'install.ps1'), 'utf8');
      return /pipeline\\build\\node_modules\\ws/.test(ps1) &&
        /npm install ws/.test(ps1);
    }],

    // Legacy dist-mode back-compat: silly-common.sh and silly-launcher.js
    // both still handle .deps/node_modules in case a user retains a prior
    // tarball install. New installs from install.{sh,ps1} do not create it.
    ['silly-common.sh still exports NODE_PATH to .deps/node_modules for legacy dist installs', () =>
      /NODE_PATH="\$root\/\.deps\/node_modules/.test(commonSh)],

    ['silly-launcher.js still threads NODE_PATH through spawn() for legacy dist installs', () =>
      /INSTALL\.nodePath/.test(launcherJs) &&
      /\.deps['"].*['"]node_modules['"]/.test(launcherJs) &&
      /env:\s*spawnEnv\(\)/.test(launcherJs)],

    // Open-source install: install.{sh,ps1} clone the public repo via git,
    // not curl-tarball. Lock that contract so a regression to the dist
    // architecture (which caused the Iter 100 Windows crash cascade)
    // fails the build.
    ['install.sh uses `git clone` instead of curl-fetching a tarball', () => {
      const sh = fs.readFileSync(path.join(root, 'installer', 'install.sh'), 'utf8');
      return /git clone/.test(sh) && !/silly-code\.tar\.gz/.test(sh);
    }],

    ['install.ps1 uses `git clone` instead of curl-fetching a tarball', () => {
      const ps1 = fs.readFileSync(path.join(root, 'installer', 'install.ps1'), 'utf8');
      return /git clone/.test(ps1) && !/silly-code\.tar\.gz/.test(ps1);
    }],
  ];

  for (const [desc, fn] of checks) {
    assert.ok(fn(), `install-mode-parity FAIL: ${desc}`);
  }

  console.log('  install-mode-parity: PASS');
})();
