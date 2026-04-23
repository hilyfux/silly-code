const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { MATCH } = require('../pipeline/match-registry.cjs');

// Iter 23 regression guard — MATCH-string / varmap token cross-reference.
//
// HAZARD: A MATCH constant in `match-registry.cjs` may embed an identifier
// that happens to be a MINIFIED VALUE in one platform's varmap but not in
// another's. When `ci-upgrade.cjs` runs the auto-rename pass, it will
// rewrite that token on the platform where it's a varmap value and leave
// it alone on the other, producing platform-divergent MATCH strings. The
// failure mode can be silent (MATCH still matches something unrelated) or
// loud (MATCH stops matching upstream) — both bad.
//
// COLLISION (a subset of asymmetry with the same shape but worse signal):
// the same bare token exists as a VALUE in more than one varmap but maps
// to DIFFERENT SEMANTIC KEYS across platforms. E.g. `Kd` could be
// `providerFamily` on darwin and `sessionCronTasks_remover` on linux —
// ci-upgrade would rewrite it into entirely different concepts per
// platform.
//
// This test scans MATCH for every identifier-shaped token and checks
// each against every varmap value table. Any token that is:
//   (a) a varmap value on some platforms but not all (ASYM), OR
//   (b) a varmap value on all platforms but maps to different semantic
//       keys (COLLISION)
// is a potential silent-corrupt landmine.

function loadVarmaps(pipelineDir) {
  const re = /^varmap-(\d+\.\d+\.\d+)(?:-([a-z0-9-]+))?\.json$/;
  const byVersion = new Map();
  for (const file of fs.readdirSync(pipelineDir)) {
    const m = file.match(re);
    if (!m) continue;
    const version = m[1];
    const raw = JSON.parse(fs.readFileSync(path.join(pipelineDir, file), 'utf8'));
    const platform = raw.platform || m[2] || 'darwin-arm64';
    const valueToSemKey = new Map();
    for (const [k, v] of Object.entries(raw)) {
      // Iter 71: also skip `_`-prefixed reserved meta keys (future-proof
      // convention shared with ci-upgrade.cjs + upgrade-probe.cjs).
      if (k === 'platform' || k === 'version' || k.startsWith('_')) continue;
      if (typeof v !== 'string' || v.length === 0) continue;
      valueToSemKey.set(v, k);
    }
    if (!byVersion.has(version)) byVersion.set(version, []);
    byVersion.get(version).push({ file, platform, valueToSemKey });
  }
  return byVersion;
}

function pickLatest(byVersion) {
  if (byVersion.size === 0) return null;
  const versions = [...byVersion.keys()].sort((a, b) => {
    const pa = a.split('.').map(n => parseInt(n, 10) || 0);
    const pb = b.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  });
  const latest = versions[versions.length - 1];
  return { version: latest, platforms: byVersion.get(latest) };
}

(function main() {
  const pipelineDir = path.join(__dirname, '..', 'pipeline');
  const byVersion = loadVarmaps(pipelineDir);
  const latest = pickLatest(byVersion);

  if (!latest || latest.platforms.length < 2) {
    console.log('match-token-drift: SKIP (need ≥2 per-platform varmaps for latest version to cross-reference)');
    return;
  }

  const platforms = latest.platforms;
  const platformNames = platforms.map(p => p.platform);

  // Build union of all tokens ever seen as a varmap value across platforms.
  const allValues = new Set();
  for (const p of platforms) for (const v of p.valueToSemKey.keys()) allValues.add(v);

  const tokenRe = /\b[A-Za-z_$][\w$]*\b/g;
  const findings = [];

  for (const [label, matchStr] of Object.entries(MATCH)) {
    const tokens = [...new Set(matchStr.match(tokenRe) || [])];
    for (const tok of tokens) {
      if (!allValues.has(tok)) continue; // not a varmap value on any platform — fine

      const present = platforms.filter(p => p.valueToSemKey.has(tok));
      const semKeys = new Set(present.map(p => p.valueToSemKey.get(tok)));

      if (present.length !== platforms.length) {
        const haveList = present.map(p => `${p.platform}→${p.valueToSemKey.get(tok)}`).join(', ');
        const missing = platformNames.filter(name => !present.some(p => p.platform === name));
        findings.push({
          kind: 'ASYM',
          label,
          tok,
          detail:
            `token "${tok}" in MATCH.${label} is a varmap value on [${haveList}] but NOT on [${missing.join(', ')}]. ` +
            `ci-upgrade will rewrite it on some platforms and leave it raw on others — platform-divergent MATCH.`,
        });
      } else if (semKeys.size > 1) {
        const map = present.map(p => `${p.platform}=${p.valueToSemKey.get(tok)}`).join('; ');
        findings.push({
          kind: 'COLLISION',
          label,
          tok,
          detail:
            `token "${tok}" in MATCH.${label} maps to DIFFERENT semantic keys across platforms: ${map}. ` +
            `ci-upgrade will rewrite it into incompatible concepts on each platform — silent corruption.`,
        });
      }
    }
  }

  const asyms = findings.filter(f => f.kind === 'ASYM');
  const collisions = findings.filter(f => f.kind === 'COLLISION');

  for (const f of findings) {
    console.log(`  [${f.kind}] MATCH.${f.label}/${f.tok}: ${f.detail}`);
  }

  assert.strictEqual(
    collisions.length,
    0,
    `${collisions.length} token(s) map to different semantic keys across platforms — silent-corrupt landmines. ` +
    `Rename the MATCH-embedded token or add platform-specific MATCH variants.`,
  );

  // Surface a bounded asymmetry budget — any growth fails the test.
  // Iter 69 (2026-04-23): lowered 1→0 after deleting MATCH.FAMILY/RESOLVE
  // (patches 13+14 were silent no-ops; removal was byte-identical and closed
  // the sole Kd ASYM). Any new MATCH-level ASYM means a real landmine.
  const ASYM_CEILING = 0;
  assert.ok(
    asyms.length <= ASYM_CEILING,
    `${asyms.length} asymmetric varmap-token finding(s), ceiling ${ASYM_CEILING}. ` +
    `Either backfill the missing platform's varmap or remove the token from MATCH.`,
  );

  // ── Phase 2: patch-body scan ────────────────────────────────
  // Iter 57 found that MATCH scanning alone misses collisions inside the
  // patch module bodies (ci-upgrade.cjs's `applyRenamesAcrossPatches` uses
  // a word-boundary rewrite over ALL patch files, not just MATCH strings).
  // Any bare identifier token in patch source that equals a varmap VALUE
  // on some platform is a potential rewrite target. Scan
  // pipeline/patches/**/*.cjs + providers/ for such tokens and apply the
  // same ASYM/COLLISION classification.
  const patchDir = path.join(__dirname, '..', 'pipeline', 'patches');
  function walkCjs(dir, acc) {
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      const st = fs.statSync(fp);
      if (st.isDirectory()) walkCjs(fp, acc);
      else if (fp.endsWith('.cjs')) acc.push(fp);
    }
    return acc;
  }
  const patchFiles = walkCjs(patchDir, []);

  const bodyFindings = [];
  for (const file of patchFiles) {
    const src = fs.readFileSync(file, 'utf8');
    // Strip comments + string literals so we only tokenize JS code.
    // WHY strings are excluded (Iter 65 re-verify): ci-upgrade.cjs's
    // `applyRenamesAcrossPatches` is a PLAIN TEXT `src.replace(/(?<![\w$])
    // oldN(?![\w$])/g, newN)` — it DOES hit string-literal content too.
    // But for patch FIND/REPLACE strings that quote upstream minified
    // code, that rewrite is INTENDED (it keeps the FIND body aligned with
    // the new upstream binary). The BODY scan's job is to catch the
    // UNINTENDED class: bare JS identifiers in patch source (local vars,
    // function names) that coincidentally equal a varmap value. Hence
    // tokenize only after stripping strings/comments — string-literal
    // rewrites are intentional, identifier rewrites are hazards.
    // Template literals are fully stripped (their `${VAR}` interpolations
    // are dropped too) — the BODY scan accepts that signal loss in exchange
    // for zero string-content false-positives.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.|\$\{[^}]*\})*`/g, '``');
    const tokens = [...new Set(stripped.match(tokenRe) || [])];
    for (const tok of tokens) {
      if (!allValues.has(tok)) continue;
      const present = platforms.filter(p => p.valueToSemKey.has(tok));
      const semKeys = new Set(present.map(p => p.valueToSemKey.get(tok)));
      const rel = path.relative(path.join(__dirname, '..'), file);
      if (present.length !== platforms.length) {
        const haveList = present.map(p => `${p.platform}→${p.valueToSemKey.get(tok)}`).join(', ');
        const missing = platformNames.filter(name => !present.some(p => p.platform === name));
        bodyFindings.push({
          kind: 'BODY_ASYM', file: rel, tok,
          detail: `token "${tok}" in ${rel} is varmap value on [${haveList}] but NOT on [${missing.join(', ')}]`,
        });
      } else if (semKeys.size > 1) {
        const map = present.map(p => `${p.platform}=${p.valueToSemKey.get(tok)}`).join('; ');
        bodyFindings.push({
          kind: 'BODY_COLLISION', file: rel, tok,
          detail: `token "${tok}" in ${rel} maps to DIFFERENT semantic keys across platforms: ${map}`,
        });
      }
    }
  }

  for (const f of bodyFindings) {
    console.log(`  [${f.kind}] ${f.file}/${f.tok}: ${f.detail}`);
  }

  const bodyCollisions = bodyFindings.filter(f => f.kind === 'BODY_COLLISION');
  const bodyAsyms = bodyFindings.filter(f => f.kind === 'BODY_ASYM');

  // Current baseline (2026-04-23, post-Iter 61):
  //  - BODY_COLLISION ceiling 0 — Iter 61 refactored auth-bypass.cjs's patch
  //    70 to use ([\w$]+) captures threaded through the replacer (Iter 20
  //    discipline), eliminating the `t8` bare hardcode. Any regression means
  //    someone re-introduced a hardcoded mangled identifier in patch source.
  //  - BODY_ASYM ceiling 0 — Iter 58 renamed `B2` → `BLOCK_2` in branding.cjs,
  //    closing the known ASYM. Any new finding means a regression.
  const BODY_COLLISION_CEILING = 0;
  const BODY_ASYM_CEILING = 0;
  assert.ok(
    bodyCollisions.length <= BODY_COLLISION_CEILING,
    `${bodyCollisions.length} patch-body token(s) map to different semantic keys across platforms, ceiling ${BODY_COLLISION_CEILING}. ` +
    `Silent-corrupt landmine — refactor the bare token to a ([\\w$]+) capture threaded through the replacer.`,
  );
  assert.ok(
    bodyAsyms.length <= BODY_ASYM_CEILING,
    `${bodyAsyms.length} patch-body token(s) collide with varmap values on some platforms, ceiling ${BODY_ASYM_CEILING}. ` +
    `Rename the local identifier to ≥4 chars (varmap values are ≤3 chars today).`,
  );

  console.log(`match-token-drift: PASS (version ${latest.version}, ${platforms.length} platforms; ` +
    `MATCH ${asyms.length} ASYM ≤ ${ASYM_CEILING} / 0 COLLISION; ` +
    `BODY ${bodyAsyms.length} ASYM ≤ ${BODY_ASYM_CEILING} / ${bodyCollisions.length} COLLISION ≤ ${BODY_COLLISION_CEILING})`);
})();
