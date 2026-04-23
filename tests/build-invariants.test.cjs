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
    const tdzNeedle = 'You are powered by the model named ${$}.';
    assert.strictEqual(
      countOccurrences(src, tdzNeedle),
      0,
      'subagent env prompt references ${$} before its declaration — patch 64 regressed',
    );
    console.log('  subagent env prompt TDZ guard: PASS');
  }

  console.log('build-invariants tests passed');
})();
