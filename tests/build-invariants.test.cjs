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

  {
    // firstParty (sillye → Claude) must see upstream identity strings byte-identical.
    // branding.cjs patches 06b/08*/09*/11a-d wrap each identity substitution in a
    // `${cond?"orig":"silly"}` (fp/fpTmpl) or `(cond?"orig":"silly")` (fpExpr)
    // guard so non-firstParty gets silly-code branding while firstParty still
    // receives the exact upstream text. If any guard regresses to an unconditional
    // silly-code replacement, the corresponding orig needle disappears and this
    // test fails loudly.
    const firstPartyNeedles = [
      // patch 06b (header title, template-interpolation of the brand word)
      '"Claude Code":"Silly Code"',
      // patch 09 (search agent)
      'You are a file search specialist for Claude Code, Anthropic\'s official CLI for Claude.',
      // patch 09a (general agent — two sites, short + long DQ literals)
      'You are an agent for Claude Code, Anthropic\'s official CLI for Claude. Given the user\'s message',
      // patch 09b (plan agent)
      'You are a software architect and planning specialist for Claude Code. Your role is to explore',
      // patch 09c (verification)
      'You are Claude, and you are bad at verification.',
      // patch 09d (statusline agent)
      'You are a status line setup agent for Claude Code. Your job is to create or update',
      // patch 09e (Claude guide agent)
      'You are the Claude guide agent. Your primary responsibility',
      // patch 09f (WebFetch error)
      'Claude Code is unable to fetch from ${H}',
      // patch 09g (Bash validate warning)
      'security, Claude Code cannot automatically validate ${H} commands',
      // patch 09h (Bash cd warning — inside DQ literal)
      'For security, Claude Code cannot automatically determine the final working directory',
      // patch 09i/09j/09k/09l/09m/09n/09o/09p (one canonical needle per)
      'You are an expert reviewer of auto mode classifier rules for Claude Code.',
      'You are evaluating a hook condition in Claude Code.',
      'You are evaluating a stop-condition hook in Claude Code.',
      'You are verifying a stop condition in Claude Code.',
      'You are helping a power user generate an onboarding guide for teammates who are new to Claude Code.',
      'You are helping the user schedule, update, list, or run **remote** Claude Code agents.',
      'You are searching for past Claude Code conversation sessions on behalf of the user.',
      'You are selecting memories that will be useful to Claude Code as it processes',
      // patch 08 (model family — firstParty branch keeps Opus/Sonnet/Haiku slugs)
      'The most recent Claude model family is Claude 4.X. Model IDs — Opus 4.7:',
      // patch 08a (Claude Code CLI description — firstParty branch)
      'Claude Code is available as a CLI in the terminal, desktop app (Mac/Windows)',
      // patch 08b (fast mode — firstParty branch)
      'Fast mode for Claude Code uses Claude Opus 4.6 with faster output',
      // patch 11a (multimodal tool description)
      'are presented visually as Claude Code is a multimodal LLM',
      // patch 11b (think-back session extractor)
      'Analyze this Claude Code session and extract structured',
      // patch 11c (think-back usage analyzer — 7 sites)
      'Analyze this Claude Code usage data',
      // patch 11d (bug report template)
      'Claude Code is an agentic coding CLI based on the Anthropic API.',
    ];
    for (const needle of firstPartyNeedles) {
      assert.ok(
        src.includes(needle),
        `firstParty identity needle "${needle.slice(0,60)}…" missing — branding.cjs regressed to unconditional silly-code replacement; sillye would lose Claude identity byte-parity`,
      );
    }
    console.log(`  firstParty identity byte-parity: PASS (${firstPartyNeedles.length} upstream needles preserved)`);
  }

  console.log('build-invariants tests passed');
})();
