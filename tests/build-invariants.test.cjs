const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'pipeline', 'build', 'cli-patched.js');

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const hit = haystack.indexOf(needle, idx);
    if (hit === -1) return count;
    count += 1;
    idx = hit + needle.length;
  }
}

(function main() {
  if (!fs.existsSync(BUILD)) {
    console.log('build-invariants: SKIP (pipeline/build/cli-patched.js absent — run `node pipeline/patch.cjs` first)');
    return;
  }

  const stat = fs.statSync(BUILD);
  const src = fs.readFileSync(BUILD, 'utf8');

  {
    const MIN = 5 * 1024 * 1024;
    const MAX = 25 * 1024 * 1024;
    assert.ok(
      stat.size >= MIN && stat.size <= MAX,
      `binary size ${stat.size} out of band [${MIN}, ${MAX}] — upstream shape drift?`,
    );
    console.log(`  size band: PASS (${stat.size} bytes)`);
  }

  {
    const brand = countOccurrences(src, 'silly-code');
    assert.ok(brand >= 10, `silly-code branding appears ${brand}× (expected ≥ 10) — branding patches may have regressed`);
    console.log(`  branding: PASS (silly-code ×${brand})`);
  }

  {
    const telemetryNeedles = [
      'statsig.anthropic',
      'api.statsig.com',
      'api.anthropic.com/v1/log',
      'sentry.io',
      'segment.io',
      'amplitude.com',
      'mixpanel',
    ];
    for (const needle of telemetryNeedles) {
      const n = countOccurrences(src, needle);
      assert.strictEqual(n, 0, `telemetry endpoint leak: "${needle}" appears ${n}× — privacy patch regressed`);
    }
    console.log(`  telemetry leak sweep: PASS (${telemetryNeedles.length} endpoints × 0)`);
  }

  {
    const marker = countOccurrences(src, 'claude.ai/code');
    const CEILING = 30;
    assert.ok(
      marker <= CEILING,
      `claude.ai/code appears ${marker}× (ceiling ${CEILING}) — investigate whether new upstream strings slipped past branding patches`,
    );
    console.log(`  claude.ai/code drift alarm: PASS (${marker} ≤ ${CEILING})`);
  }

  {
    // Patch 64 (MODEL_ID) scope uses `z` as the model-name var, `H` as ID.
    // Patch 64b (MODEL_ID_2) scope uses `Y` as the model-name var, `H` as ID.
    // Any other var in the name slot is a scope-leak regression: `${$}` was
    // the original TDZ bug (see 78295d5), `${H}` swaps name with ID. Assert
    // the correct scope vars land, and nothing else does.
    const goodNeedles = [
      'You are powered by the model named ${z}.',
      'You are powered by the model named ${Y}.',
    ];
    const badNeedles = [
      'You are powered by the model named ${$}.',
      'You are powered by the model named ${H}.',
    ];
    for (const needle of goodNeedles) {
      assert.ok(
        countOccurrences(src, needle) >= 1,
        `expected scope-correct subagent env prompt "${needle}" — patch 64/64b regressed`,
      );
    }
    for (const needle of badNeedles) {
      assert.strictEqual(
        countOccurrences(src, needle),
        0,
        `scope leak in subagent env prompt: "${needle}" — patch 64/64b injected the wrong scope var`,
      );
    }
    console.log('  subagent env prompt scope guard (64 ${z} + 64b ${Y}): PASS');
  }

  console.log('build-invariants tests passed');
})();
