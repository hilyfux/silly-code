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
const { fetchAndStageFromBunBinary, stageFromLocalBunBinary } = require('./bun-extract.cjs');

const ROOT = path.join(__dirname, '..');
const PIPELINE = __dirname;
const UPSTREAM_DIR = path.join(PIPELINE, 'upstream');
const PATCHES_DIR = path.join(PIPELINE, 'patches');
const PKG = '@anthropic-ai/claude-code';
const TEST_MODE = process.env.SILLY_CI_UPGRADE_TEST_MODE === '1';
// DRY_RUN (Iter 82): print intended actions and exit cleanly before any
// disk-mutating stage. Useful for inspecting "what would this run do" without
// detonating npm-pack + bun-extract + varmap-regen + cross-patch-rename. v1
// scope: short-circuits the whole upgrade body after diagnostics; future v2
// can thread per-stage dry-run through applyVarRenames / applyRenamesAcrossPatches
// (see memory/project-ci-upgrade-dry-run-gap.md leverage #2 plan).
const DRY_RUN = process.env.SILLY_CI_UPGRADE_DRY_RUN === '1';
const LOCAL_NATIVE_BINARY = process.env.SILLY_CI_UPGRADE_LOCAL_BINARY || '';

function envJson(name, fallback = null) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return JSON.parse(raw);
}

const TEST_VERSION_PAIR = envJson('SILLY_CI_UPGRADE_TEST_VERSION_PAIR');
const TEST_PATCH_RESULT = envJson('SILLY_CI_UPGRADE_TEST_PATCH_RESULT');
const TEST_TEST_RESULT = envJson('SILLY_CI_UPGRADE_TEST_TEST_RESULT');
const TEST_KG_DIR = process.env.SILLY_CI_UPGRADE_TEST_KG_DIR || null;
const TEST_VARMAP = envJson('SILLY_CI_UPGRADE_TEST_VARMAP');
const TEST_CONTENT_ANCHOR_COUNT = Number(process.env.SILLY_CI_UPGRADE_TEST_CONTENT_ANCHOR_COUNT || '0');
const TEST_WRITE_OUTPUT = process.env.SILLY_CI_UPGRADE_TEST_WRITE_OUTPUT === '1';
const KG_DIR = TEST_KG_DIR || path.join(ROOT, '.knowledge-graph');
const KG_EVENTS = path.join(KG_DIR, 'graph-events.jsonl');
const KG_SNAPSHOT = path.join(KG_DIR, 'work-snapshot.md');
const PATCH_FILES = [
  'branding.cjs', 'provider-core.cjs', 'provider-ux.cjs', 'provider-identity.cjs',
  'equality.cjs', 'privacy.cjs',
].map(f => path.join(PATCHES_DIR, f));
const MATCH_REGISTRY = path.join(PIPELINE, 'match-registry.cjs');

function log(msg) { process.stderr.write(`[ci-upgrade] ${msg}\n`); }
function die(code, msg) { log('ERR: ' + msg); process.exit(code); }

function nowIso() {
  return new Date().toISOString();
}

function ensureKnowledgeGraphDir() {
  fs.mkdirSync(KG_DIR, { recursive: true });
}

function readUpgradeEvents() {
  if (!fs.existsSync(KG_EVENTS)) return [];
  return fs.readFileSync(KG_EVENTS, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(event => event && event.type === 'upstream_upgrade_attempt');
}

function topFragileAreas(events) {
  const counts = new Map();
  for (const event of events) {
    for (const item of event?.patch?.failing_list || []) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `- ${name} (${count} recent failures)`);
}

function deriveLessons({ failingList, testFailure, contentAnchorApplied, buildOk, status }) {
  const lessons = [];
  if (failingList.includes('provider-engine')) {
    lessons.push('provider-engine match strings remain a recurring fragility point');
  }
  if (contentAnchorApplied && buildOk) {
    lessons.push('content-anchor rename sweep resolved identifier drift');
  }
  if (status === 'tests-failed' || testFailure === 'tests/providers.test.cjs') {
    lessons.push('semantic/provider regression surfaced after string-level patching');
  }
  if (!lessons.length && buildOk) {
    lessons.push('varmap rename sweep was sufficient');
  }
  return lessons;
}

function rewriteUpgradeSnapshot(events) {
  const recent = events.slice(-5).reverse();
  const latest = recent[0];
  const knownFragile = topFragileAreas(events.slice(-10));
  const latestLines = latest ? [
    `- Current repo upstream version: ${latest.current_version}`,
    `- Last attempted target: ${latest.target_version}`,
    `- Last result: ${latest.result}`,
    `- Last timestamp: ${latest.ts}`,
  ] : ['- No upgrade attempts recorded yet'];
  const recentLines = recent.length
    ? recent.map(event => `- ${event.current_version} -> ${event.target_version}: ${event.result}${event.patch?.failing_list?.length ? ` (${event.patch.failing_list.join(', ')})` : event.tests?.failed_test ? ` (${event.tests.failed_test})` : ''}`)
    : ['- No recent attempts'];
  const recommended = latest?.next_action === 'none'
    ? ['- No action needed right now']
    : latest?.next_action === 'manual_patch_review'
      ? ['- Inspect the repeated failing patch modules first', '- Compare the newest varmap against the previous released version']
      : latest?.next_action === 'invoke_agent'
        ? ['- Re-run the scheduled fallback or /upstream-upgrade with the latest snapshot in context']
        : ['- Review the latest failing modules and test output before retrying'];
  const content = [
    '# Upstream Upgrade Snapshot',
    '',
    '## Latest status',
    ...latestLines,
    '',
    '## Recent attempts',
    ...recentLines,
    '',
    '## Known fragile areas',
    ...(knownFragile.length ? knownFragile : ['- No recurring failure clusters yet']),
    '',
    '## Recommended next recovery step',
    ...recommended,
    '',
  ].join('\n');
  fs.writeFileSync(KG_SNAPSHOT, content);
}

function persistUpgradeEvent(event) {
  try {
    ensureKnowledgeGraphDir();
    fs.appendFileSync(KG_EVENTS, JSON.stringify(event) + '\n');
    rewriteUpgradeSnapshot(readUpgradeEvents());
  } catch (error) {
    log(`WARN: failed to persist knowledge-graph event: ${error.message}`);
  }
}

function finalizeAttempt({
  current,
  latest,
  result,
  ciExitCode,
  status,
  failingList = [],
  testFailure = null,
  varmapApplied = false,
  contentAnchorApplied = false,
  buildOk = false,
  nextAction = 'none',
}) {
  const event = {
    type: 'upstream_upgrade_attempt',
    ts: nowIso(),
    runner: process.env.GITHUB_ACTIONS ? 'ci' : 'local',
    workflow: 'upstream-upgrade',
    current_version: current,
    target_version: latest,
    result,
    ci_exit_code: ciExitCode,
    status,
    auto_fix: {
      varmap_applied: varmapApplied,
      content_anchor_applied: contentAnchorApplied,
    },
    patch: {
      build_ok: buildOk,
      failing_count: failingList.length,
      failing_list: failingList,
    },
    tests: {
      ok: !testFailure,
      failed_test: testFailure,
    },
    artifacts: {
      varmap_file: `pipeline/varmap-${latest}.json`,
    },
    lessons: deriveLessons({ failingList, testFailure, contentAnchorApplied, buildOk, status }),
    next_action: nextAction,
  };
  persistUpgradeEvent(event);
}

function escapeStepValue(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function readUpgradeSnapshot() {
  if (!fs.existsSync(KG_SNAPSHOT)) return '';
  return fs.readFileSync(KG_SNAPSHOT, 'utf8').trim();
}

function writeKnowledgeGraphOutputs() {
  writeOutput({ kg_summary: escapeStepValue(readUpgradeSnapshot()) });
}

let varmapApplied = false;
let contentAnchorApplied = false;
let latestVersionForFailure = null;
let currentVersionForFailure = null;
let latestStatusForFailure = 'unexpected-error';
let latestFailingListForFailure = [];
let latestTestFailureForFailure = null;
let latestBuildOkForFailure = false;
let latestNextActionForFailure = 'manual_patch_review';
let terminalEventWritten = false;

function finalizeAndExit(code, payload) {
  finalizeAttempt(payload);
  writeKnowledgeGraphOutputs();
  terminalEventWritten = true;
  process.exit(code);
}

function finalizeUnexpectedAndExit(code, error) {
  finalizeAttempt({
    current: currentVersionForFailure || 'unknown',
    latest: latestVersionForFailure || 'unknown',
    result: 'unexpected-error',
    ciExitCode: code,
    status: latestStatusForFailure,
    failingList: latestFailingListForFailure,
    testFailure: latestTestFailureForFailure,
    varmapApplied,
    contentAnchorApplied,
    buildOk: latestBuildOkForFailure,
    nextAction: latestNextActionForFailure,
  });
  writeKnowledgeGraphOutputs();
  terminalEventWritten = true;
  if (error) log('unexpected error: ' + (error.stack || error.message || error));
  process.exit(code);
}

process.on('uncaughtException', error => {
  if (!terminalEventWritten) finalizeUnexpectedAndExit(3, error);
});

process.on('unhandledRejection', error => {
  if (!terminalEventWritten) finalizeUnexpectedAndExit(3, error);
});

writeKnowledgeGraphOutputs();

function concludeAlreadyCurrent(current, latest) {
  finalizeAndExit(0, {
    current,
    latest,
    result: 'already-current',
    ciExitCode: 0,
    status: 'already-current',
    varmapApplied,
    contentAnchorApplied,
    buildOk: true,
    nextAction: 'none',
  });
}

function concludeBroken(current, latest, failingList) {
  finalizeAndExit(2, {
    current,
    latest,
    result: 'broken',
    ciExitCode: 2,
    status: 'broken',
    failingList,
    varmapApplied,
    contentAnchorApplied,
    buildOk: false,
    nextAction: 'manual_patch_review',
  });
}

function concludeTestsFailed(current, latest, failedTest) {
  finalizeAndExit(2, {
    current,
    latest,
    result: 'tests-failed',
    ciExitCode: 2,
    status: 'tests-failed',
    testFailure: failedTest,
    varmapApplied,
    contentAnchorApplied,
    buildOk: true,
    nextAction: 'invoke_agent',
  });
}

function concludeUpgraded(current, latest) {
  finalizeAndExit(1, {
    current,
    latest,
    result: 'upgraded',
    ciExitCode: 1,
    status: 'upgraded',
    varmapApplied,
    contentAnchorApplied,
    buildOk: true,
    nextAction: 'none',
  });
}

function concludeUnexpected(current, latest) {
  finalizeAndExit(3, {
    current,
    latest,
    result: 'unexpected-error',
    ciExitCode: 3,
    status: 'unexpected-error',
    varmapApplied,
    contentAnchorApplied,
    buildOk: false,
    nextAction: 'manual_patch_review',
  });
}

ensureKnowledgeGraphDir();
writeKnowledgeGraphOutputs();

// ── 1. Version check ────────────────────────────────────────
function getCurrentVersion() {
  if (TEST_VERSION_PAIR?.current) return TEST_VERSION_PAIR.current;
  const deps = JSON.parse(fs.readFileSync(path.join(ROOT, 'deps.json'), 'utf8'));
  return deps.deps.upstream.version;
}

function getLatestVersion() {
  if (TEST_VERSION_PAIR?.latest) return TEST_VERSION_PAIR.latest;
  try {
    return execSync(`npm view ${PKG} version`, { encoding: 'utf8' }).trim();
  } catch (e) {
    die(3, 'npm view failed: ' + e.message);
  }
}

function shouldSkipRealUpgradeWork() {
  return TEST_MODE;
}

// ── 2. Fetch tarball ────────────────────────────────────────
function fetchTarball(version) {
  if (shouldSkipRealUpgradeWork()) return path.join(PIPELINE, 'upstream', 'package');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'silly-up-'));
  execSync(`npm pack ${PKG}@${version} --pack-destination ${tmp}`, {
    cwd: tmp, stdio: ['pipe', 'pipe', 'inherit'],
  });
  const tgz = `anthropic-ai-claude-code-${version}.tgz`;
  execSync(`tar -xzf "${tgz}"`, { cwd: tmp, stdio: 'pipe' });
  return path.join(tmp, 'package');
}

// ── 3. Stage upstream files ─────────────────────────────────
// Since upstream 2.1.113 the npm wrapper no longer contains cli.js — the real
// source lives embedded inside the Bun-compiled native binary shipped via
// `@anthropic-ai/claude-code-<platform>`. Detect that layout and fall back to
// bun-extract.cjs, which stages an equivalent cli.js so the rest of the
// pipeline (varmap/content-anchor/regex patches) runs unchanged.
function stageUpstream(packageDir, version) {
  if (shouldSkipRealUpgradeWork()) return;
  const cliSrc = path.join(packageDir, 'cli.js');
  const stagedDir = path.join(UPSTREAM_DIR, 'package');
  if (fs.existsSync(cliSrc)) {
    fs.copyFileSync(cliSrc, path.join(stagedDir, 'cli.js'));
    fs.copyFileSync(path.join(packageDir, 'package.json'), path.join(stagedDir, 'package.json'));
    return;
  }
  log('  cli.js absent in wrapper tarball — falling back to bun-extract from native binary');
  const r = fetchAndStageFromBunBinary(version, stagedDir);
  log(`  bun-extract staged cli.js (${r.cliJsBytes.toLocaleString()} bytes) for ${r.platform}`);
}

function stageUpstreamFromLocalBinary(version) {
  if (shouldSkipRealUpgradeWork()) return;
  const stagedDir = path.join(UPSTREAM_DIR, 'package');
  const r = stageFromLocalBunBinary(LOCAL_NATIVE_BINARY, stagedDir, { version });
  log(`  local bun-extract staged cli.js (${r.cliJsBytes.toLocaleString()} bytes) for ${r.platform}`);
}

// ── 4. Version string bumps ─────────────────────────────────
function bumpVersionRefs(oldVer, newVer) {
  if (shouldSkipRealUpgradeWork()) return;
  const files = [
    path.join(ROOT, 'deps.json'),
    path.join(PATCHES_DIR, 'branding.cjs'),
    MATCH_REGISTRY,
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
  if (TEST_VARMAP && TEST_VARMAP[version]) return TEST_VARMAP[version];
  const p = path.join(PIPELINE, `varmap-${version}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function regenerateVarmap() {
  if (shouldSkipRealUpgradeWork()) return;
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
  // Iter 72: platform guard. `oldMap` (pre-upgrade staged varmap) and
  // `newMap` (post-upgrade candidate varmap) MUST describe the same bundle
  // platform — cross-platform renames silently corrupt patch source
  // (Iter 23 landmine: `Kd` means `providerFamily` on darwin and
  // `sessionCronTasks_remover` on linux). The source of truth for the
  // currently staged platform is `upstream/package/package.json::silly-code:platform`.
  //   * soft check: if either side is missing `platform` (e.g. legacy
  //     varmap-2.1.114.json pre-Iter-72), skip the assertion so upgrade
  //     can still run through the transition.
  //   * hard check: if both declare `platform`, they MUST match each other
  //     AND match the staged upstream bundle. Mismatch → throw before any
  //     rewrite touches patch source.
  if (oldMap.platform && newMap.platform && oldMap.platform !== newMap.platform) {
    throw new Error(
      `ci-upgrade: cross-platform varmap rename blocked — oldMap.platform="${oldMap.platform}" but newMap.platform="${newMap.platform}". ` +
      `A rename pair drawn from different-platform bundles silently corrupts patch source. ` +
      `Fix: regenerate the new-version varmap against the same platform as the staged upstream (see bun-extract.cjs --platform).`
    );
  }
  try {
    const upstreamPkgPath = path.join(UPSTREAM_DIR, 'package', 'package.json');
    if (fs.existsSync(upstreamPkgPath)) {
      const upstreamPkg = JSON.parse(fs.readFileSync(upstreamPkgPath, 'utf8'));
      const stagedPlatform = upstreamPkg['silly-code:platform'];
      if (stagedPlatform && newMap.platform && stagedPlatform !== newMap.platform) {
        throw new Error(
          `ci-upgrade: varmap platform mismatch — newMap.platform="${newMap.platform}" but staged upstream is "${stagedPlatform}" (${upstreamPkgPath}). ` +
          `Regenerate the varmap for ${stagedPlatform} before applying renames.`
        );
      }
    }
  } catch (e) {
    if (e instanceof SyntaxError) { /* malformed upstream package.json — skip guard, let downstream fail loud */ }
    else throw e;
  }
  // Iter 71: tighten schema filter. Only semantic-key → mangled-name string
  // pairs participate in the cross-patch word-boundary rewrite; metadata
  // fields (`platform`, `version`, any future `_`-prefixed reserved key)
  // and non-string values must never be coerced to a rename pair. Prior
  // code only filtered `version`, leaving `platform` as a silent-corrupt
  // hole if an upgrade ever shipped with a different `platform` header.
  const isSemanticKey = (k) =>
    k !== 'version' && k !== 'platform' && !k.startsWith('_');
  const renames = Object.keys(newMap)
    .filter((k) => isSemanticKey(k)
      && typeof oldMap[k] === 'string'
      && typeof newMap[k] === 'string'
      && oldMap[k] && oldMap[k] !== newMap[k])
    .map(k => [oldMap[k], newMap[k], k]);
  if (!renames.length) { log('  no varmap renames to apply'); return 0; }
  log(`  applying ${renames.length} varmap renames: ${renames.map(r => `${r[0]}→${r[1]}(${r[2]})`).join(', ')}`);
  log(`  rewrote ${applyRenamesAcrossPatches(renames.map(r => [r[0], r[1]]))} patch file(s)`);
  varmapApplied = true;
  return renames.length;
}
// Extract IDENT="..." and var IDENT="..." match strings from our patches, then
// search the new binary for the same literal tail preceded by a different
// identifier. This catches identity-style vars (Fh1 / qb1 etc.) that the
// varmap's LANDMARKS miss. Function-body anchoring was attempted and removed
// — minifiers change body contents too often to make it reliable.
function contentAnchorRename() {
  if (TEST_MODE) {
    if (TEST_CONTENT_ANCHOR_COUNT > 0) contentAnchorApplied = true;
    return TEST_CONTENT_ANCHOR_COUNT;
  }
  const newSrc = fs.readFileSync(path.join(UPSTREAM_DIR, 'package/cli.js'), 'utf8');
  const engine = fs.readFileSync(MATCH_REGISTRY, 'utf8');
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
  contentAnchorApplied = true;
  return renames.length;
}

// ── 7. Rebuild + test ───────────────────────────────────────
function runPatch() {
  if (TEST_PATCH_RESULT) {
    return {
      ok: !!TEST_PATCH_RESULT.ok,
      fails: TEST_PATCH_RESULT.fails || [],
      out: TEST_PATCH_RESULT.out || '',
    };
  }
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
  if (TEST_TEST_RESULT) {
    return {
      ok: !!TEST_TEST_RESULT.ok,
      which: TEST_TEST_RESULT.which,
      out: TEST_TEST_RESULT.out || '',
    };
  }
  for (const t of ['tests/base.test.cjs', 'tests/schema.test.cjs', 'tests/providers.test.cjs']) {
    const r = spawnSync('node', [t], { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (r.status !== 0) return { ok: false, which: t, out: (r.stdout || '') + (r.stderr || '') };
  }
  return { ok: true };
}

if (TEST_WRITE_OUTPUT) {
  process.env.GITHUB_OUTPUT = process.env.GITHUB_OUTPUT || path.join(KG_DIR, 'github-output.txt');
}

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
  // Guard against require-time detonation. This file is an unattended upgrade
  // runner; `require('./pipeline/ci-upgrade.cjs')` from a sibling test or probe
  // would otherwise trigger the full npm-pack + bun-extract + varmap-regen +
  // cross-patch-rename flow at import time (see memory/project-ci-upgrade-
  // no-require-guard.md — Iter 72-73 incident). Only the direct `node
  // pipeline/ci-upgrade.cjs` invocation should execute the upgrade body.
  if (require.main !== module) return;

  const current = getCurrentVersion();
  const latest = getLatestVersion();
  currentVersionForFailure = current;
  latestVersionForFailure = latest;
  log(`current=${current} latest=${latest}`);
  writeOutput({ current, latest });

  if (current === latest) {
    log('already current, nothing to do');
    concludeAlreadyCurrent(current, latest);
  }

  // Iter 82: dry-run exit. Print the intended action plan and exit before
  // touching disk. Deliberately placed AFTER version diagnostics (so dry-run
  // output includes current→latest) and BEFORE every mutation stage.
  if (DRY_RUN) {
    log(`DRY-RUN: would upgrade ${current} → ${latest}`);
    log('DRY-RUN: planned stages (all skipped):');
    log(LOCAL_NATIVE_BINARY
      ? '  1. stageUpstreamFromLocalBinary (local native binary + write upstream/package/)'
      : '  1. fetchTarball + stageUpstream (npm pack + write upstream/package/)');
    log('  2. bumpVersionRefs (rewrite deps.json, match-registry.cjs, branding.cjs)');
    log('  3. regenerateVarmap (run upgrade-probe derive step)');
    log('  4. applyVarRenames (cross-patch word-boundary rewrite)');
    log('  5. runPatch + content-anchor rename sweep');
    log('  6. npm test');
    log('  7. git commit + push (commit-and-push stage)');
    log('DRY-RUN: no disk mutations performed; exiting 0');
    process.exit(0);
  }

  // Before staging: load OLD varmap for rename diff
  const oldMap = loadVarmap(current);

  if (LOCAL_NATIVE_BINARY) {
    log(`staging from local native binary: ${LOCAL_NATIVE_BINARY}`);
    stageUpstreamFromLocalBinary(latest);
  } else {
    log('fetching tarball...');
    const pkgDir = fetchTarball(latest);
    stageUpstream(pkgDir, latest);
  }

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
  latestFailingListForFailure = r.fails;
  if (!r.ok && r.fails.length) {
    log(`first build failed: ${r.fails.length} patches broken [${r.fails.slice(0, 10).join(', ')}${r.fails.length > 10 ? ', ...' : ''}]`);
    log('running content-anchor rename sweep...');
    const n = contentAnchorRename();
    if (n > 0) {
      log('retrying build after content-anchor...');
      r = runPatch();
      latestFailingListForFailure = r.fails;
    }
  }

  if (!r.ok) {
    log('build still failing after auto-fix');
    latestStatusForFailure = 'broken';
    latestNextActionForFailure = 'manual_patch_review';
    writeOutput({
      status: 'broken',
      failing_count: r.fails.length,
      failing_list: r.fails.join(','),
    });
    concludeBroken(current, latest, r.fails);
  }

  latestBuildOkForFailure = true;
  log('build OK — running tests...');
  const t = runTests();
  if (!t.ok) {
    log(`tests failed: ${t.which}`);
    latestStatusForFailure = 'tests-failed';
    latestTestFailureForFailure = t.which;
    latestNextActionForFailure = 'invoke_agent';
    writeOutput({ status: 'tests-failed', failing_list: t.which });
    concludeTestsFailed(current, latest, t.which);
  }

  log('all green');
  writeOutput({ status: 'upgraded', failing_count: 0, failing_list: '' });
  concludeUpgraded(current, latest);
})().catch(e => {
  if (!terminalEventWritten) finalizeUnexpectedAndExit(3, e);
});
