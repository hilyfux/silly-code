/**
 * match-registry.cjs — Centralized MATCH constants + anchor guards
 *
 * Single source of truth for all upstream binary match strings.
 * Consumed by: provider-core, provider-ux, provider-identity, upgrade-probe, ci-upgrade
 *
 * Tri-layer anchor model:
 *   Layer 1 (varmap): EH, uq, uM, DR1 — auto-renamed by ci-upgrade
 *   Layer 2 (content-anchor): qI6, joq, Doq, wB — auto-re-anchored via string tail
 *   Layer 2b (self-anchored): z2 — function pattern → rename causes build fail
 *   Layer 3 (bare inject): kV, Qi, YU, Yh — MUST have structural guard below
 */

// ── Match string constants (upstream v2.1.114) ──
const MATCH = {
  DETECT:      'return EH(process.env.CLAUDE_CODE_USE_BEDROCK)?"bedrock"',
  INJECT:      'M=uM(q);if(M==="bedrock")',
  CONTEXT_DEFAULT: 'AE6=200000',
  DISPLAY:     'function z2(H){if(uq()==="foundry")return;',
  IDENTITY:    'qI6="You are Claude Code, Anthropic\'s official CLI for Claude."',
  SDK_ID:      'joq="You are Claude Code, Anthropic\'s official CLI for Claude, running within the Claude Agent SDK."',
  AGENT_ID:    'Doq="You are a Claude agent, built on Anthropic\'s Claude Agent SDK."',
  MODEL_ID:    'You are powered by the model named ${z}. The exact model ID is ${H}.',
  MODEL_ID_2:  'You are powered by the model named ${Y}. The exact model ID is ${H}.',
  SIMPLE_ID:   '?"You are Claude Code, Anthropic\'s official CLI for Claude.":`You are Claude Code, Anthropic\'s official CLI for Claude.',
  TIER:        'case"max":return"Claude Max";case"pro":return"Claude Pro";default:return"Claude API"',
  CONSTRUCTOR: 'kV',
  VERSION:     '// Version: 2.1.114',
};

// ── Layer 3 structural guards ──
// Identifiers injected into REPLACEMENT side with no echo in FIND side.
// A rename passes patch-time and breaks at runtime unless guarded here.
const BARE_INJECT_TOKENS = [
  [MATCH.CONSTRUCTOR,
    `class\\s+${MATCH.CONSTRUCTOR.replace(/[$]/g, '\\$')}\\s+extends[^{]*\\{[^}]*this\\.messages\\s*=\\s*new`,
    'Anthropic SDK client class',
    "grep 'this.messages=new' upstream/package/cli.js"],
  ['Qi',
    `function\\s+Qi\\(H\\)\\{m_\\.scheduledTasksEnabled=H\\}`,
    'scheduledTasksEnabled setter (patch 27 inject-only — disable /loop scheduler on shutdown)',
    "grep -oE 'function Qi.H.\\{m_.scheduledTasksEnabled' upstream/package/cli.js"],
  ['YU',
    `function\\s+YU\\(H\\)\\{if\\(H\\.length===0\\)return 0;[^{}]*m_\\.sessionCronTasks`,
    'sessionCronTasks remover (patch 27 inject-only — drop loop crons on shutdown)',
    "grep -oE 'function YU.H.\\{if.H.length' upstream/package/cli.js"],
  ['Yh',
    `function\\s+Yh\\(\\)\\{return\\s+m_\\.sessionCronTasks\\}`,
    'sessionCronTasks getter (patch 27 inject-only — read loop crons on shutdown)',
    "grep -oE 'function Yh...return m_.sessionCronTasks' upstream/package/cli.js"],
];

function verifyAnchors(upstreamSrc) {
  for (const [name, reSrc, kind, hint] of BARE_INJECT_TOKENS) {
    if (!new RegExp(reSrc, 's').test(upstreamSrc)) {
      throw new Error(
        `silent-coupling guard: '${name}' (${kind}) not found via structural regex. ` +
        `Injection would succeed silently but runtime will break. Hint: ${hint}`
      );
    }
  }
}

// ── Varmap discovery ──
// Returns the path to the varmap-<ver>.json that matches the upstream binary
// checked into `pipeline/upstream/package/`. Rationale: assertions against the
// patched build (which comes from that exact upstream) need the matching
// varmap, not a draft varmap staged ahead of an upstream bump.
//
// Resolution order:
//   1. Exact match: `varmap-<upstream.version>.json` (platform-plain file preferred)
//   2. Fallback: highest semver varmap (legacy behavior — used when upstream
//      package.json is missing or unreadable, e.g. in ci-upgrade dry runs)
//
// Filename convention: `varmap-<ver>.json` (canonical/darwin) or
// `varmap-<ver>-<platform>-<arch>.json` (per-platform). Only the canonical
// file is considered here; platform-specific variants are consumed separately
// (see tests/varmap-parity.test.cjs).
function latestVarmap(pipelineDir) {
  const fs = require('fs');
  const path = require('path');
  const parse = v => v.split('.').map(n => parseInt(n, 10) || 0);

  const allFiles = fs.readdirSync(pipelineDir).filter(f => /^varmap-.+\.json$/.test(f));
  if (allFiles.length === 0) return null;

  // Canonical (no platform suffix) varmaps only.
  const canonical = allFiles.filter(f => /^varmap-\d+\.\d+\.\d+\.json$/.test(f));

  // Try to pin to upstream's actual version.
  try {
    const pkgPath = path.join(pipelineDir, 'upstream', 'package', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const pin = `varmap-${pkg.version}.json`;
    if (canonical.includes(pin)) return path.join(pipelineDir, pin);
  } catch { /* fall through to highest-semver */ }

  // Fallback: highest semver canonical, or highest across all if no canonicals.
  const pool = canonical.length ? canonical : allFiles;
  pool.sort((a, b) => {
    const pa = parse(a.slice(7, -5));
    const pb = parse(b.slice(7, -5));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  });
  return path.join(pipelineDir, pool[pool.length - 1]);
}

module.exports = { MATCH, BARE_INJECT_TOKENS, verifyAnchors, latestVarmap };
