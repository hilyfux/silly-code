const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Cross-platform varmap semantic-keyset parity.
//
// For any upstream version that ships multiple per-platform varmap files
// (`pipeline/varmap-<ver>.json` = darwin-arm64 default, plus
// `pipeline/varmap-<ver>-linux-x64.json`, `-win32-x64.json`, …), the SEMANTIC
// KEYSET must be identical across all platforms. The minified VALUES are
// expected to differ (bun-compile mangling is platform-scoped), but a
// missing semantic KEY on one platform means `ci-upgrade.cjs` will silently
// skip rewriting patch strings that reference that identifier on that
// platform — and silent skip = corrupt build.
//
// History: Iter 23 (2026-04-22) discovered that varmap-2.1.117.json had
// 5 Layer-3 names whose minified values differed on linux vs darwin. The
// keyset was symmetric (same semantics) but the per-platform mangling
// required independent JSONs. If someone later adds a 32nd semantic key
// to darwin without mirroring to linux/win32, ci-upgrade produces a
// corrupt linux binary with no build-time signal. This test is that
// missing signal.

(function main() {
  const pipelineDir = path.join(__dirname, '..', 'pipeline');
  const varmapRe = /^varmap-(\d+\.\d+\.\d+)(?:-([a-z0-9-]+))?\.json$/;
  const entries = fs.readdirSync(pipelineDir)
    .map(f => {
      const m = f.match(varmapRe);
      return m ? { file: f, version: m[1], platform: m[2] || 'darwin-arm64' } : null;
    })
    .filter(Boolean);

  // group by version
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.version)) groups.set(e.version, []);
    groups.get(e.version).push(e);
  }

  let multiPlatformVersions = 0;
  for (const [version, variants] of groups) {
    if (variants.length < 2) continue; // single-platform version — nothing to compare
    multiPlatformVersions++;

    const loaded = variants.map(v => ({
      ...v,
      data: JSON.parse(fs.readFileSync(path.join(pipelineDir, v.file), 'utf8')),
    }));

    // (1) Each varmap's `platform` metadata must match its filename hint, and
    //     `version` metadata must match the version in its filename. This
    //     catches "renamed the file but forgot to update the header" drift.
    for (const m of loaded) {
      assert.strictEqual(
        m.data.platform, m.platform,
        `varmap-parity FAIL: ${m.file} platform="${m.data.platform}" but filename says "${m.platform}"`
      );
      assert.strictEqual(
        m.data.version, version,
        `varmap-parity FAIL: ${m.file} version="${m.data.version}" but filename says "${version}"`
      );
    }

    // (2) Semantic keyset must be identical across all platforms for this version.
    const union = new Set();
    for (const m of loaded) for (const k of Object.keys(m.data)) union.add(k);
    for (const m of loaded) {
      const mySet = new Set(Object.keys(m.data));
      const missing = [...union].filter(k => !mySet.has(k)).sort();
      assert.ok(
        missing.length === 0,
        `varmap-parity FAIL: ${m.file} is missing ${missing.length} semantic key(s) present on peer platform(s): [${missing.join(', ')}]. ` +
        `Adding a semantic key on one platform without mirroring across all breaks ci-upgrade on the unmirrored platform — silent corrupt (see Iter 23 history). ` +
        `Fix: add the same semantic key (with the platform-correct minified value) to ${m.file}.`
      );
    }

    // (3) Every non-metadata key must map to a non-empty minified token. A blank
    //     token would cause ci-upgrade to search-and-replace against '', nuking
    //     the entire binary on rewrite.
    //
    // Iter 71 schema contract:
    //   - `platform`, `version` are reserved string metadata
    //   - keys starting with `_` are reserved for future opaque metadata
    //     (ci-upgrade / upgrade-probe / match-token-drift all skip them)
    //   - every OTHER key is a semantic-key → mangled-name string pair and
    //     must be a non-empty string
    // A new unknown meta-shaped field would violate this contract loudly
    // instead of silently poisoning the cross-patch rewriter.
    for (const m of loaded) {
      for (const [sem, tok] of Object.entries(m.data)) {
        if (sem === 'platform' || sem === 'version') {
          assert.ok(
            typeof tok === 'string' && tok.length > 0,
            `varmap-parity FAIL: ${m.file}.${sem} = ${JSON.stringify(tok)} — reserved meta key must be a non-empty string`
          );
          continue;
        }
        if (sem.startsWith('_')) continue; // opaque reserved meta slot
        assert.ok(
          typeof tok === 'string' && tok.length > 0,
          `varmap-parity FAIL: ${m.file}.${sem} = ${JSON.stringify(tok)} — semantic-key value must be a non-empty minified-name string (wrap in _-prefix if this is metadata)`
        );
      }
    }

    console.log(
      `  varmap-parity: ${version} — ${loaded.length} platforms (` +
      loaded.map(m => m.platform).join(', ') +
      `), ${union.size} semantic keys match`
    );
  }

  if (multiPlatformVersions === 0) {
    console.log('  varmap-parity: no multi-platform versions found (nothing to check)');
  }
  console.log('  varmap-parity: PASS');
})();
