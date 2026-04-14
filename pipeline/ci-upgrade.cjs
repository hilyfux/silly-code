#!/usr/bin/env node
/**
 * ci-upgrade.cjs — unattended upstream upgrade for GitHub Actions.
 *
 * Exit codes (GitHub workflow branches on these):
 *   0 = already current, no action needed
 *   1 = upgraded successfully, changes staged (CI opens PR)
 *   2 = new version available but auto-upgrade failed (CI opens Issue)
 *   3 = unexpected error (CI fails workflow)
 *
 * Pipeline:
 *   1. `npm pack` latest @anthropic-ai/claude-code
 *   2. If version unchanged → exit 0
 *   3. Stage new cli.js + package.json
 *   4. Bump version refs in deps.json / branding.cjs / provider-engine.cjs
 *   5. Apply renames from varmap diff (old → new) to patch files
 *   6. Content-anchored auto-rename for failing identity-style patches
 *   7. Rebuild + run tests
 *   8. Exit 1 if green, 2 if still failing
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PIPELINE = __dirname;
const UPSTREAM_DIR = path.join(PIPELINE, 'upstream');
const PATCHES_DIR = path.join(PIPELINE, 'patches');
const PKG = '@anthropic-ai/claude-code';

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
  try {
    execSync(
      `node ${path.join(PIPELINE, 'upgrade.cjs')} scan ${path.join(UPSTREAM_DIR, 'package/cli.js')} --save`,
      { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (e) {
    log('scan --save failed: ' + (e.message || '').slice(0, 200));
  }
}

function applyVarRenames(oldMap, newMap) {
  if (!oldMap || !newMap) return 0;
  const renames = [];
  for (const k of Object.keys(newMap)) {
    if (k === 'version') continue;
    if (oldMap[k] && newMap[k] && oldMap[k] !== newMap[k]) {
      renames.push([oldMap[k], newMap[k], k]);
    }
  }
  if (!renames.length) { log('  no varmap renames to apply'); return 0; }

  log(`  applying ${renames.length} varmap renames: ${renames.map(r => `${r[0]}→${r[1]}(${r[2]})`).join(', ')}`);

  // Order: longer names first to avoid partial hits (A14 before A)
  renames.sort((a, b) => b[0].length - a[0].length);

  const patchFiles = [
    path.join(PATCHES_DIR, 'branding.cjs'),
    path.join(PATCHES_DIR, 'provider-engine.cjs'),
    path.join(PATCHES_DIR, 'equality.cjs'),
    path.join(PATCHES_DIR, 'privacy.cjs'),
  ];
  let totalChanges = 0;
  for (const f of patchFiles) {
    if (!fs.existsSync(f)) continue;
    let src = fs.readFileSync(f, 'utf8');
    const orig = src;
    for (const [oldN, newN] of renames) {
      // Word-boundary aware replace. $ counts as word char in JS regex so custom boundary needed.
      const re = new RegExp('(?<![\\w$])' + escapeRe(oldN) + '(?![\\w$])', 'g');
      src = src.replace(re, newN);
    }
    if (src !== orig) {
      fs.writeFileSync(f, src);
      totalChanges++;
    }
  }
  log(`  rewrote ${totalChanges} patch file(s)`);
  return renames.length;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── 6. Content-anchored auto-rename for failing patches ─────
function contentAnchorRename(oldVer, newVer) {
  // Look at MATCH constants in provider-engine.cjs and branding.cjs.
  // For each match that still fails, try to find the "new name" that prefixes
  // a distinctive literal (identity strings, function bodies with fixed
  // argument signatures, etc.) in the current upstream cli.js.

  const newSrc = fs.readFileSync(path.join(UPSTREAM_DIR, 'package/cli.js'), 'utf8');
  const engine = fs.readFileSync(path.join(PATCHES_DIR, 'provider-engine.cjs'), 'utf8');
  const branding = fs.readFileSync(path.join(PATCHES_DIR, 'branding.cjs'), 'utf8');

  // Candidate patterns: `IDENT="literal..."` or `function IDENT(q){...` etc.
  // For each, extract the literal suffix and search new binary for matching tail.

  const tryAnchor = (matchStr) => {
    // Case 1: IDENT="..."
    let m = matchStr.match(/^([A-Za-z_$][\w$]*)(="[^"]*")/);
    if (m) {
      const [_, oldName, suffix] = m;
      const re = new RegExp('([A-Za-z_$][\\w$]*)' + escapeRe(suffix));
      const hit = newSrc.match(re);
      if (hit && hit[1] !== oldName) return { oldName, newName: hit[1] };
    }
    // Case 2: function IDENT(args){body} — take first ~40 chars of body as anchor
    m = matchStr.match(/^function ([A-Za-z_$][\w$]*)(\([^)]*\)\{[^}]{8,40})/);
    if (m) {
      const [_, oldName, anchor] = m;
      const re = new RegExp('function ([A-Za-z_$][\\w$]*)' + escapeRe(anchor));
      const hit = newSrc.match(re);
      if (hit && hit[1] !== oldName) return { oldName, newName: hit[1] };
    }
    // Case 3: var IDENT="literal" (minified `var X="..."`)
    m = matchStr.match(/^var ([A-Za-z_$][\w$]*)(="[^"]*")/);
    if (m) {
      const [_, oldName, suffix] = m;
      const re = new RegExp('var ([A-Za-z_$][\\w$]*)' + escapeRe(suffix));
      const hit = newSrc.match(re);
      if (hit && hit[1] !== oldName) return { oldName, newName: hit[1] };
    }
    return null;
  };

  // Extract all literal MATCH strings from provider-engine.cjs's MATCH object
  const mObjStart = engine.indexOf('const MATCH = {');
  if (mObjStart < 0) return 0;
  const mObjEnd = engine.indexOf('};', mObjStart);
  const mBlock = engine.slice(mObjStart, mObjEnd);
  const literalRe = /[A-Z_]+:\s+'((?:[^'\\]|\\.)*)'/g;
  const literals = [];
  let m;
  while ((m = literalRe.exec(mBlock)) !== null) {
    literals.push(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
  }

  // Also grep 2-5 character identifier-prefixed literals from branding patches
  const brandingStrings = Array.from(branding.matchAll(/'([A-Za-z_$][\w$]{0,8}=".{5,}")/g)).map(x => x[1]);
  const brandingStrings2 = Array.from(branding.matchAll(/'(var [A-Za-z_$][\w$]{0,8}="[^"]+")/g)).map(x => x[1]);

  const candidates = [...literals, ...brandingStrings, ...brandingStrings2];
  const renames = [];
  const seen = new Set();
  for (const s of candidates) {
    const r = tryAnchor(s);
    if (r && !seen.has(r.oldName + '->' + r.newName)) {
      // Skip "common" names; only accept if newName appears in newSrc but oldName doesn't (in the same anchor role)
      seen.add(r.oldName + '->' + r.newName);
      // Verify oldName doesn't still anchor in newSrc (otherwise we'd be breaking valid usage)
      if (!newSrc.includes(s)) {
        renames.push([r.oldName, r.newName]);
      }
    }
  }

  if (!renames.length) return 0;

  log(`  content-anchor found ${renames.length} rename(s): ${renames.map(r => `${r[0]}→${r[1]}`).join(', ')}`);

  renames.sort((a, b) => b[0].length - a[0].length);

  const patchFiles = [
    path.join(PATCHES_DIR, 'branding.cjs'),
    path.join(PATCHES_DIR, 'provider-engine.cjs'),
    path.join(PATCHES_DIR, 'equality.cjs'),
    path.join(PATCHES_DIR, 'privacy.cjs'),
  ];
  for (const f of patchFiles) {
    if (!fs.existsSync(f)) continue;
    let src = fs.readFileSync(f, 'utf8');
    const orig = src;
    for (const [oldN, newN] of renames) {
      const re = new RegExp('(?<![\\w$])' + escapeRe(oldN) + '(?![\\w$])', 'g');
      src = src.replace(re, newN);
    }
    if (src !== orig) fs.writeFileSync(f, src);
  }
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
  for (const t of ['tests/base.test.cjs', 'tests/schema.test.cjs']) {
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
    const n = contentAnchorRename(current, latest);
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
