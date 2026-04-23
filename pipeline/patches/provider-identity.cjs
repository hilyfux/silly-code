/**
 * provider-identity.cjs — Provider-aware identity + display patches
 *
 * Patches: 60, 61, 62, 63, 63a, 64, 64b, 65, 66, 67
 * Pillar: Dual-Provider (Claude + Codex)
 *
 * Changes when: identity strings leak, upstream adds new identity vars,
 * or tier naming changes. Independent of core injection (10-15)
 * and UX (50-55).
 */

const { MATCH } = require('../match-registry.cjs');
const { providers, fallback } = require('./_providers.cjs');

module.exports = function applyProviderIdentity({ patch }) {
  // ── Shared: identity branch builders ──
  const identityBranches = providers
    .filter(p => p.runtimeId !== 'firstParty')
    .map(p => `if(_p==="${p.runtimeId}")return"${p.identity.systemPrompt}";`)
    .join('');
  const originalIdentity = "You are Claude Code, Anthropic\\'s official CLI for Claude.";

  // ── Patch 60: Model display name ──
  const displayProviders = providers.filter(p => p.identity.modelDisplayNames);
  if (displayProviders.length > 0) {
    const displayBranches = displayProviders.map(p => {
      const names = p.identity.modelDisplayNames;
      const entries = Object.entries(names).filter(([k]) => k !== 'default');
      const checks = entries.map(([model, display]) =>
        `if(_m.includes("${model}"))return"${display}";`
      ).join('');
      return `if(uq()==="${p.runtimeId}"){let _m=H.toLowerCase();${checks}return"${names.default}";}`;
    }).join('');

    patch('60-model-display-name',
      MATCH.DISPLAY,
      `function z2(H){${displayBranches}if(uq()==="foundry")return;`
    );
  }

  // ── Patch 61: System prompt identity ──
  // Anthropic server validates Bh1 integrity for firstParty.
  // Bh1 MUST keep its original value for firstParty, only override for third-party.
  patch('61-system-identity',
    MATCH.IDENTITY,
    `qI6=(()=>{const _p=typeof uq==="function"?uq():"firstParty";${identityBranches}return"${originalIdentity}";})()`
  );

  // ── Patch 62: SDK identity ──
  // Anthropic server validates z14 integrity for firstParty.
  // Per-provider sdkPrompt resolution: each non-firstParty provider emits its
  // own identity.sdkPrompt (claude.cjs keeps the generic Silly Code string as
  // the shared fallback). Using providers.find() here leaked Claude's sdkPrompt
  // into OpenAI because claude.cjs loads first — mirroring agentBranches below.
  const fallbackSdk = 'You are Silly Code, a multi-provider AI coding assistant, running within the Agent SDK.';
  const originalSdk = "You are Claude Code, Anthropic\\'s official CLI for Claude, running within the Claude Agent SDK.";
  const sdkBranches = providers
    .filter(p => p.runtimeId !== 'firstParty')
    .map(p => `if(_p==="${p.runtimeId}")return"${p.identity.sdkPrompt || fallbackSdk}";`)
    .join('');
  patch('62-sdk-identity',
    MATCH.SDK_ID,
    `joq=(()=>{const _p=typeof uq==="function"?uq():"firstParty";${sdkBranches}return"${originalSdk}";})()`
  );

  // ── Patch 64: Model ID in prompt (two occurrences with different var names) ──
  patch('64-model-id-in-prompt',
    MATCH.MODEL_ID,
    'You are powered by the model named ${z}.'
  );
  patch('64b-model-id-in-prompt-2',
    MATCH.MODEL_ID_2,
    'You are powered by the model named ${H}.'
  );

  // ── Patch 65: Agent identity ──
  // Anthropic server validates system prompt integrity for firstParty.
  const agentBranches = providers
    .filter(p => p.runtimeId !== 'firstParty')
    .map(p => `if(_p==="${p.runtimeId}")return"${p.identity.agentPrompt}";`)
    .join('');
  const originalAgent = "You are a Claude agent, built on Anthropic\\'s Claude Agent SDK.";
  patch('65-agent-identity',
    MATCH.AGENT_ID,
    `Doq=(()=>{const _p=typeof uq==="function"?uq():"firstParty";${agentBranches}return"${originalAgent}";})()`
  );

  // ── Patch 63a: Simple identity ──
  const simpleBranches = providers
    .filter(p => p.runtimeId !== 'firstParty')
    .map(p => `if(_p==="${p.runtimeId}")return"${p.identity.simplePrompt}";`)
    .join('');
  const fallbackSimple = fallback.identity.simplePrompt;
  const fallbackFull = fallback.identity.systemPrompt;
  patch('63a-prompt-simple-identity',
    MATCH.SIMPLE_ID,
    `?(()=>{const _p=typeof uq==="function"?uq():"firstParty";${simpleBranches}return"${fallbackSimple}";})()`
    + `:((()=>{const _p=typeof uq==="function"?uq():"firstParty";${identityBranches}return"${fallbackFull}";})())+\``
  );

  // ── Patch 63: Tier display ──
  const tierLevels = ['max', 'pro', 'api'];
  const tierCases = tierLevels.map((level) => {
    const branches = providers
      .filter(p => p.runtimeId !== 'firstParty')
      .map(p => `(typeof uq==="function"&&uq()==="${p.runtimeId}")?"${p.tierNames[level]}"`)
      .join(':');
    const fallbackTier = fallback.tierNames[level];
    const prefix = level === 'api' ? 'default' : `case"${level}"`;
    return `${prefix}:return ${branches}:"${fallbackTier}"`;
  });
  patch('63-tier-display',
    MATCH.TIER,
    tierCases.join(';')
  );

  // ── Patch 67: Public model display name — provider-aware ──
  patch('67-public-model-display',
    'function JqH(H){let _=H.endsWith("[1m]")?" (1M context)":"";switch',
    'function JqH(H){if(typeof uq==="function"&&uq()!=="firstParty"){let _n=z2(H);if(_n)return _n;}let _=H.endsWith("[1m]")?" (1M context)":"";switch'
  );

  // Patch 66 (fast-mode-display) removed in 2.1.114:
  // upstream eliminated the `var wB="Opus 4.6"` fallback; display now flows
  // entirely through JqH (patched via 67), so the provider-aware branching
  // is already covered.
};
