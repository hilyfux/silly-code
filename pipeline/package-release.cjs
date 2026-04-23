#!/usr/bin/env node
// Build silly-code.tar.gz from the patched binary + launchers.
// Assumes `node pipeline/patch.cjs` has already produced pipeline/build/cli-patched.js.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Guard against require-time detonation. Same pattern as pipeline/ci-upgrade.cjs
// (Iter 80): the entire file body below runs at require-time — stage() wipes
// dist/, vendorWs() spawns npm install, packTar() shells out to `tar`. A stray
// require() would detonate the full release build. Iter 83 closure —
// defense-in-depth, not a feature.
if (require.main !== module) return;

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'pipeline', 'build');
const PATCHED_CLI = path.join(BUILD_DIR, 'cli-patched.js');
const STAGE_DIR = path.join(BUILD_DIR, 'dist');
const OUT_TARBALL = path.join(ROOT, 'silly-code.tar.gz');

const deps = JSON.parse(fs.readFileSync(path.join(ROOT, 'deps.json'), 'utf8'));
const VERSION = deps.deps.upstream.version;
if (!VERSION) throw new Error('deps.upstream.version missing from deps.json');

const PKG_ROOT = path.join(STAGE_DIR, 'silly-code');

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function cp(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  const mode = fs.statSync(src).mode & 0o777;
  fs.chmodSync(dst, mode);
}

function stage() {
  rmrf(STAGE_DIR);
  fs.mkdirSync(PKG_ROOT, { recursive: true });

  if (!fs.existsSync(PATCHED_CLI)) {
    throw new Error(`Missing ${PATCHED_CLI} — run \`node pipeline/patch.cjs\` first`);
  }
  cp(PATCHED_CLI, path.join(PKG_ROOT, 'versions', VERSION));

  cp(path.join(ROOT, 'deps.json'), path.join(PKG_ROOT, 'deps.json'));

  const launchers = ['silly', 'sillye', 'sillyes', 'sillyx', 'sillyxs'];
  for (const name of launchers) {
    cp(path.join(ROOT, 'bin', name), path.join(PKG_ROOT, 'bin', name));
  }

  const libFromBin = [
    'auth-files.sh',
    'install-upgrade-cron.sh',
    'lib-deps.sh',
    'silly-auth.js',
    'silly-common.sh',
    'silly-launcher.js',
    'silly.js',
    'sillye.js',
    'sillyes.js',
    'sillyx.js',
    'sillyxs.js',
    'upgrade-check.sh',
  ];
  for (const name of libFromBin) {
    cp(path.join(ROOT, 'bin', name), path.join(PKG_ROOT, 'bin', '.lib', name));
  }
  cp(path.join(ROOT, 'pipeline', 'login.mjs'), path.join(PKG_ROOT, 'bin', '.lib', 'login.mjs'));
  cp(path.join(ROOT, 'installer', 'uninstall.sh'), path.join(PKG_ROOT, 'bin', '.lib', 'uninstall.sh'));
  cp(path.join(ROOT, 'installer', 'uninstall.ps1'), path.join(PKG_ROOT, 'bin', '.lib', 'uninstall.ps1'));

  fs.writeFileSync(
    path.join(PKG_ROOT, 'bin', '.lib', 'package.json'),
    JSON.stringify({ type: 'module' }) + '\n'
  );
}

function vendorWs() {
  const depsDir = path.join(PKG_ROOT, '.deps');
  fs.mkdirSync(depsDir, { recursive: true });
  // npm install walks up to find package.json, so seed one in depsDir
  fs.writeFileSync(path.join(depsDir, 'package.json'), JSON.stringify({ name: '.deps', private: true }) + '\n');
  execSync('npm install ws --no-save --no-audit --no-fund --ignore-scripts --silent', {
    cwd: depsDir,
    stdio: 'inherit',
  });
  rmrf(path.join(depsDir, 'package.json'));
  rmrf(path.join(depsDir, 'package-lock.json'));
}

function packTar() {
  rmrf(OUT_TARBALL);
  execSync(`tar -czf "${OUT_TARBALL}" -C "${STAGE_DIR}" silly-code`, { stdio: 'inherit' });
  const size = fs.statSync(OUT_TARBALL).size;
  console.log(`[package-release] wrote ${path.relative(ROOT, OUT_TARBALL)} (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

stage();
vendorWs();
packTar();
