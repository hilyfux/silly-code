#!/usr/bin/env node
/**
 * ci-upgrade.cjs — unattended upstream upgrade.
 *
 * Exit codes (watched by upstream-upgrade.yml):
 *   0 = already current
 *   1 = upgraded cleanly
 *   2 = new version found but auto-fix couldn't finish
 *   3 = unexpected error
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { scan } = require('./upgrade.cjs');

const ROOT = path.join(__dirname, '..');
const PIPELINE = __dirname;
const UPSTREAM_DIR = path.join(PIPELINE, 'upstream');
const PATCHES_DIR = path.join(PIPELINE, 'patches');
const PKG = '@anthropic-ai/claude-code';
const PATCH_FILES = ['branding.cjs', 'provider-engine.cjs', 'equality.cjs', 'privacy.cjs']
  .map(f => path.join(PATCHES_DIR, f));

function log(msg) { process.stderr.write(`[ci-upgrade] ${msg}\n`); }
function die(code, msg) { log('ERR: ' + msg); process.exit(code); }

// ── 1. Version check ────────────────────────────────────────
function getCurrentVersion() {
  const deps = JSON.parse(fs.readFileSync(path.join(ROOT, 'deps.json'), 'utf8'));
  return deps.deps.upstream.version;
}

function getLatestVersion() {
  try {
    return execSync(`npm view ${PKG} version`, { encoding: 'utf8' }).trim();
  } catch (e) {
    die(3, 'npm view failed: ' + e.message);
  }
}

// ── 2. Fetch tarball ────────────────────────────────────────
function fetchTarball(version) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'silly-up-'));
  execSync(`npm pack ${PKG}@${version} --pack-destination ${tmp}`, {
    cwd: tmp, stdio: ['pipe', 'pipe', 'inherit'],
  });
  const tgz = `anthropic-ai-claude-code-${version}.tgz`;
  execSync(`tar -xzf "${tgz}"`, { cwd: tmp, stdio: 'pipe' });
  return path.join(tmp, 'package');
}

// ── 3. Stage upstream files ─────────────────────────────────
function stageUpstream(packageDir) {
  fs.copyFileSync(path.join(packageDir, 'cli.js'), path.join(UPSTREAM_DIR, 'package/cli.js'));
  fs.copyFileSync(path.join(packageDir, 'package.json'), path.join(UPSTREAM_DIR, 'package/package.json'));
}

// ── 4. Version string bumps ─────────────────────────────────
function bumpVersionRefs(oldVer, newVer) {
  const files = [
    path.join(ROOT, 'deps.json'),
    path.join(PATCHES_DIR, 'branding.cjs'),
    path.join(PATCHES_DIR, 'provider-engine.cjs'),
    path.join(ROOT, 'README.md'),
  ];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    const next = src.split(oldVer).join(newVer);
    if (next !== src) {
      fs.writeFileSync(f, next);
      log(`  bumped ${path.relative(ROOT, f)}: ${oldVer} → ${newVer}`);
    }
  }
}

// ── 5. Apply varmap rename diff to patch files ──────────────
function loadVarmap(version) {
  const p = path.join(PIPELINE, `varmap-${version}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function regenerateVarmap() {
  const { vars } = scan(path.join(UPSTREAM_DIR, 'package/cli.js'));
  const mapFile = path.join(PIPELINE, `varmap-${vars.version || 'unknown'}.json`);
  fs.writeFileSync(mapFile, JSON.stringify(vars, null, 2));
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function applyRenamesAcrossPatches(renames) {
  if (!renames.length) return 0;
  renames.sort((a, b) => b[0].length - a[0].length);
  let changed = 0;
  for (const f of PATCH_FILES) {
    if (!fs.existsSync(f)) continue;
    let src = fs.readFileSync(f, 'utf8');
    const orig = src;
    for (const [oldN, newN] of renames) {
      const re = new RegExp('(?<![\\w$])' + escapeRe(oldN) + '(?![\\w$])', 'g');
      src = src.replace(re, newN);
    }
    if (src !== orig) { fs.writeFileSync(f, src); changed++; }
  }
  return changed;
}

function applyVarRenames(oldMap, newMap) {
  if (!oldMap || !newMap) return 0;
  const renames = Object.keys(newMap)
    .filter(k => k !== 'version' && oldMap[k] && oldMap[k] !== newMap[k])
    .map(k => [oldMap[k], newMap[k], k]);
  if (!renames.length) { log('  no varmap renames to apply'); return 0; }
  log(`  applying ${renames.length} varmap renames: ${renames.map(r => `${r[0]}→${r[1]}(${r[2]})`).join(', ')}`);
  log(`  rewrote ${applyRenamesAcrossPatches(renames.map(r => [r[0], r[1]]))} patch file(s)`);
  return renames.length;
}

// Extract IDENT="..." and var IDENT="..." match strings from our patches, then
// search the new binary for the same literal tail preceded by a different
// identifier. This catches identity-style vars (Fh1 / qb1 etc.) that the
// varmap's LANDMARKS miss. Function-body anchoring was attempted and removed
// — minifiers change body contents too often to make it reliable.
function contentAnchorRename() {
  const newSrc = fs.readFileSync(path.join(UPSTREAM_DIR, 'package/cli.js'), 'utf8');
  const engine = fs.readFileSync(path.join(PATCHES_DIR, 'provider-engine.cjs'), 'utf8');
  const branding = fs.readFileSync(path.join(PATCHES_DIR, 'branding.cjs'), 'utf8');

  const tryAnchor = (matchStr) => {
    const m = matchStr.match(/^(?:var )?([A-Za-z_$][\w$]*)(="[^"]*")/);
    if (!m) return null;
    const [prefix, oldName, suffix] = [m[0].startsWith('var ') ? 'var ' : '', m[1], m[2]];
    const re = new RegExp(prefix + '([A-Za-z_$][\\w$]*)' + escapeRe(suffix));
    const hit = newSrc.match(re);
    return (hit && hit[1] !== oldName) ? { oldName, newName: hit[1] } : null;
  };

  const mBlock = engine.slice(engine.indexOf('const MATCH = {'), engine.indexOf('};', engine.indexOf('const MATCH = {')));
  const literals = Array.from(mBlock.matchAll(/[A-Z_]+:\s+'((?:[^'\\]|\\.)*)'/g))
    .map(x => x[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
  const brandingLits = Array.from(branding.matchAll(/'((?:var )?[A-Za-z_$][\w$]{0,8}="[^"]+")/g))
    .map(x => x[1]);

  const renames = [];
  const seen = new Set();
  for (const s of [...literals, ...brandingLits]) {
    const r = tryAnchor(s);
    if (!r || seen.has(r.oldName + '->' + r.newName)) continue;
    seen.add(r.oldName + '->' + r.newName);
    if (!newSrc.includes(s)) renames.push([r.oldName, r.newName]);
  }

  if (!renames.length) return 0;
  log(`  content-anchor found ${renames.length} rename(s): ${renames.map(r => `${r[0]}→${r[1]}`).join(', ')}`);
  applyRenamesAcrossPatches(renames);
  return renames.length;
}

// ── 7. Rebuild + test ───────────────────────────────────────
function runPatch() {
  const r = spawnSync('node', [path.join(PIPELINE, 'patch.cjs')], {
    cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  const fails = [];
  for (const ln of out.split('\n')) {
    const m = ln.match(/✗\s+([^\s—]+)/);
    if (m) fails.push(m[1]);
  }
  return { ok, fails, out };
}

function runTests() {
  for (const t of ['tests/base.test.cjs', 'tests/schema.test.cjs', 'tests/providers.test.cjs']) {
    const r = spawnSync('node', [t], { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (r.status !== 0) return { ok: false, which: t, out: (r.stdout || '') + (r.stderr || '') };
  }
  return { ok: true };
}

// ── 8. Write summary for GitHub Actions outputs ─────────────
function writeOutput(kv) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  const lines = Object.entries(kv).map(([k, v]) => {
    const s = String(v).replace(/\n/g, '\\n');
    return `${k}=${s}`;
  });
  fs.appendFileSync(out, lines.join('\n') + '\n');
}

// ── Main ────────────────────────────────────────────────────
(async function main() {
  const current = getCurrentVersion();
  const latest = getLatestVersion();
  log(`current=${current} latest=${latest}`);
  writeOutput({ current, latest });

  if (current === latest) {
    log('already current, nothing to do');
    process.exit(0);
  }

  // Before staging: load OLD varmap for rename diff
  const oldMap = loadVarmap(current);

  log('fetching tarball...');
  const pkgDir = fetchTarball(latest);
  stageUpstream(pkgDir);

  log('bumping version refs...');
  bumpVersionRefs(current, latest);

  log('regenerating varmap from staged upstream...');
  regenerateVarmap();
  const newMap = loadVarmap(latest);
  if (!newMap) {
    log('WARN: no new varmap generated; proceeding without rename sweep');
  }

  log('applying varmap renames...');
  applyVarRenames(oldMap, newMap);

  log('trying first build...');
  let r = runPatch();
  if (!r.ok && r.fails.length) {
    log(`first build failed: ${r.fails.length} patches broken [${r.fails.slice(0, 10).join(', ')}${r.fails.length > 10 ? ', ...' : ''}]`);
    log('running content-anchor rename sweep...');
    const n = contentAnchorRename();
    if (n > 0) {
      log('retrying build after content-anchor...');
      r = runPatch();
    }
  }

  if (!r.ok) {
    log('build still failing after auto-fix');
    writeOutput({
      status: 'broken',
      failing_count: r.fails.length,
      failing_list: r.fails.join(','),
    });
    process.exit(2);
  }

  log('build OK — running tests...');
  const t = runTests();
  if (!t.ok) {
    log(`tests failed: ${t.which}`);
    writeOutput({ status: 'tests-failed', failing_list: t.which });
    process.exit(2);
  }

  log('all green');
  writeOutput({ status: 'upgraded', failing_count: 0, failing_list: '' });
  process.exit(1);
})().catch(e => {
  log('unexpected error: ' + (e.stack || e.message || e));
  process.exit(3);
});
