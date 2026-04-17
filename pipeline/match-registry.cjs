/**
 * match-registry.cjs — Centralized MATCH constants + anchor guards
 *
 * Single source of truth for all upstream binary match strings.
 * Consumed by: provider-core, provider-ux, provider-identity, upgrade-probe, ci-upgrade
 *
 * Tri-layer anchor model:
 *   Layer 1 (varmap): S6, pq, YM, KA, $Q, DR1 — auto-renamed by ci-upgrade
 *   Layer 2 (content-anchor): Tb1, pq4, Fq4, wB — auto-re-anchored via string tail
 *   Layer 2b (self-anchored): xW — function pattern → rename causes build fail
 *   Layer 3 (bare inject): qh, uvK — MUST have structural guard below
 */

// ── Match string constants (upstream v2.1.112) ──
const MATCH = {
  DETECT:      'return S6(process.env.CLAUDE_CODE_USE_BEDROCK)?"bedrock"',
  INJECT:      'P=YM(_);if(P==="bedrock")',
  RESOLVE:     'function KA(q=pq()){return q==="firstParty"||q==="anthropicAws"}',
  FAMILY:      'function $Q(q=pq()){return q==="firstParty"||q==="anthropicAws"||q==="foundry"||q==="mantle"}',
  CONTEXT_DEFAULT: 'DR1=200000',
  DISPLAY:     'function xW(q){if(pq()==="foundry")return;',
  IDENTITY:    'Tb1="You are Claude Code, Anthropic\'s official CLI for Claude."',
  SDK_ID:      'pq4="You are Claude Code, Anthropic\'s official CLI for Claude, running within the Claude Agent SDK."',
  AGENT_ID:    'Fq4="You are a Claude agent, built on Anthropic\'s Claude Agent SDK."',
  MODEL_ID:    'You are powered by the model named ${$}. The exact model ID is ${q}.',
  MODEL_ID_2:  'You are powered by the model named ${H}. The exact model ID is ${q}.',
  SIMPLE_ID:   '?"You are Claude Code, Anthropic\'s official CLI for Claude.":`You are Claude Code, Anthropic\'s official CLI for Claude.',
  TIER:        'case"max":return"Claude Max";case"pro":return"Claude Pro";default:return"Claude API"',
  CONSTRUCTOR: 'qh',
  VERSION:     '// Version: 2.1.112',
};

// ── Layer 3 structural guards ──
// Identifiers injected into REPLACEMENT side with no echo in FIND side.
// A rename passes patch-time and breaks at runtime unless guarded here.
const BARE_INJECT_TOKENS = [
  [MATCH.CONSTRUCTOR,
    `class\\s+${MATCH.CONSTRUCTOR.replace(/[$]/g, '\\$')}\\s+extends[^{]*\\{[^}]*this\\.messages\\s*=\\s*new`,
    'Anthropic SDK client class',
    "grep 'this.messages=new' upstream/package/cli.js"],
  ['uvK',
    `function\\s+uvK\\b`,
    'Opus 4.6 menu item builder (patch 53 inject-only ref)',
    "grep -oE 'function uvK|\"Opus 4\\.6\"' upstream/package/cli.js"],
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

module.exports = { MATCH, BARE_INJECT_TOKENS, verifyAnchors };
