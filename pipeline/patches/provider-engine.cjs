/**
 * provider-engine.cjs — Loads provider configs, validates schemas,
 * generates all provider-related patches from aggregated configs.
 *
 * Replaces: providers.cjs, identity.cjs, platform.cjs
 */

const fs = require('fs');
const path = require('path');

// ── Load providers ──
const PROVIDERS_DIR = path.join(__dirname, 'providers');
const base = require(path.join(PROVIDERS_DIR, '_base.cjs'));
const providerFiles = fs.readdirSync(PROVIDERS_DIR)
  .filter(f => f.endsWith('.cjs') && f !== '_base.cjs')
  .sort();
const providers = providerFiles.map(f => {
  const p = require(path.join(PROVIDERS_DIR, f));
  // Normalize contextWindow shorthand
  if (typeof p.contextWindow === 'number') {
    p.contextWindow = { default: p.contextWindow, perModel: {} };
  } else if (p.contextWindow && !p.contextWindow.perModel) {
    p.contextWindow = { ...p.contextWindow, perModel: {} };
  }
  return p;
});

// ── Schema validation ──
function validate(providers) {
  const keys = new Set();
  const runtimeIds = new Set();
  const envKeys = new Set();
  const priorities = new Set();
  let defaultCount = 0;

  for (const p of providers) {
    // key
    if (!p.key || typeof p.key !== 'string') throw new Error(`Provider missing key`);
    if (keys.has(p.key)) throw new Error(`Duplicate provider key: ${p.key}`);
    keys.add(p.key);

    // runtimeId
    if (!p.runtimeId || typeof p.runtimeId !== 'string') throw new Error(`${p.key}: missing runtimeId`);
    if (runtimeIds.has(p.runtimeId)) throw new Error(`Duplicate runtimeId: ${p.runtimeId} (provider ${p.key})`);
    runtimeIds.add(p.runtimeId);

    // envKey
    if (p.envKey === null) {
      defaultCount++;
      if (p.runtimeId !== 'firstParty') throw new Error(`${p.key}: default provider (envKey: null) must have runtimeId: 'firstParty'`);
    } else {
      if (envKeys.has(p.envKey)) throw new Error(`Duplicate envKey: ${p.envKey}`);
      envKeys.add(p.envKey);
    }

    // priority
    if (p.priority != null) {
      if (priorities.has(p.priority)) throw new Error(`Duplicate priority: ${p.priority} (provider ${p.key})`);
      priorities.add(p.priority);
    }

    // models
    if (p.models && !p.models.default) throw new Error(`${p.key}: models table missing 'default' entry`);

    // tierNames
    if (!p.tierNames || !p.tierNames.max || !p.tierNames.pro || !p.tierNames.api) {
      throw new Error(`${p.key}: tierNames must have max, pro, api`);
    }

    // adapter/auth pairing
    if (p.adapter && !p.auth) throw new Error(`${p.key}: adapter requires auth`);
    if (p.adapter && typeof p.adapter !== 'function') throw new Error(`${p.key}: adapter must be a function`);
    if (p.auth && typeof p.auth !== 'function') throw new Error(`${p.key}: auth must be a function`);

    // identity
    if (!p.identity?.systemPrompt) throw new Error(`${p.key}: identity.systemPrompt required`);

    // contextWindow
    if (p.contextWindow && typeof p.contextWindow.default !== 'number') {
      throw new Error(`${p.key}: contextWindow.default must be a number`);
    }
  }

  if (defaultCount !== 1) throw new Error(`Exactly one provider must have envKey: null (found ${defaultCount})`);
}

// ── Match string constants (upstream v2.1.101) ──
const MATCH = {
  DETECT:      'return F6(process.env.CLAUDE_CODE_USE_BEDROCK)?"bedrock"',
  INJECT:      'P=cX(_);if(P==="bedrock")',
  RESOLVE:     'function D$(q=dq()){return q==="firstParty"||q==="anthropicAws"}',
  FAMILY:      'function lg(q=dq()){return q==="firstParty"||q==="anthropicAws"||q==="foundry"||q==="mantle"}',
  CONTEXT_DEFAULT: 'xL1=200000',
  DISPLAY:     'function y0(q){if(dq()==="foundry")return;',
  IDENTITY:    'Bh1="You are Claude Code, Anthropic\'s official CLI for Claude."',
  SDK_ID:      'z14="You are Claude Code, Anthropic\'s official CLI for Claude, running within the Claude Agent SDK."',
  AGENT_ID:    'Y14="You are a Claude agent, built on Anthropic\'s Claude Agent SDK."',
  MODEL_ID:    'You are powered by the model named ${$}. The exact model ID is ${q}.',
  SIMPLE_ID:   '?"You are Claude Code, Anthropic\'s official CLI for Claude.":`You are Claude Code, Anthropic\'s official CLI for Claude.',
  TIER:        'case"max":return"Claude Max";case"pro":return"Claude Pro";default:return"Claude API"',
  CONSTRUCTOR: 'gL',
  VERSION:     '// Version: 2.1.101',
};

// ── Serialization safeguards ──
function checkSerialization(code, label) {
  // Static scan
  if (/\brequire\s*\(/.test(code)) throw new Error(`${label}: bare require() detected`);
  if (/\b(module|exports|__dirname|__filename)\b/.test(code)) throw new Error(`${label}: module-scope reference detected`);
  const importMatches = code.match(/import\s*\([^)]+\)/g) || [];
  for (const im of importMatches) {
    if (!im.includes("'node:") && !im.includes('"node:')) throw new Error(`${label}: non-node: import detected: ${im}`);
  }
  // Isolation compile check (compile-level defense)
  try {
    new Function(code);
  } catch (e) {
    throw new Error(`${label}: compile check failed — ${e.message}`);
  }
  // Minimal execution verification: invoke with no-op fetch mock
  try {
    const mockFetch = () => Promise.resolve(new Response('{}', { status: 200 }));
    new Function('fetch', code)(mockFetch);
  } catch (e) {
    // ReferenceErrors during execution are expected (missing runtime vars like dq, cX)
    // Only fail on SyntaxError or TypeError indicating broken code structure
    if (e instanceof SyntaxError || e instanceof TypeError) {
      throw new Error(`${label}: execution verification failed — ${e.message}`);
    }
  }
}

// ── Patch generation ──
module.exports = function applyProviders({ patch }) {
  validate(providers);

  const sorted = providers
    .filter(p => p.priority != null)
    .sort((a, b) => a.priority - b.priority);
  const fallback = providers.find(p => p.priority == null);
  const allRuntimeIds = providers.filter(p => p.runtimeId !== 'firstParty').map(p => p.runtimeId);

  // ── Patch 10: Provider detection ──
  const detectChain = sorted.map(p =>
    `F6(process.env.${p.envKey})?"${p.runtimeId}"`
  ).join(':');
  patch('10-provider-detection',
    MATCH.DETECT,
    'return ' + detectChain + ':' + MATCH.DETECT.replace('return ', '')
  );

  // ── Patch 13: Model resolution ──
  const resolveExt = allRuntimeIds.map(id => `||q==="${id}"`).join('');
  patch('13-model-resolution',
    MATCH.RESOLVE,
    MATCH.RESOLVE.replace(
      'q==="firstParty"||q==="anthropicAws"}',
      'q==="firstParty"||q==="anthropicAws"' + resolveExt + '}'
    )
  );

  // ── Patch 14: Provider family ──
  const familyExt = allRuntimeIds.map(id => `||q==="${id}"`).join('');
  patch('14-provider-family',
    MATCH.FAMILY,
    MATCH.FAMILY.replace(
      'q==="foundry"||q==="mantle"}',
      'q==="foundry"||q==="mantle"' + familyExt + '}'
    )
  );

  // ── Patch 11-12: Adapter injection ──
  const adaptersWithCode = providers.filter(p => p.adapter);
  // Serialize _base.cjs functions
  const baseStr = Object.values(base).map(f => f.toString()).join(';');
  // Serialize per-provider state + auth + adapter
  const providerStrs = adaptersWithCode.map(p => {
    return `let _${p.key}Data=null;` +
      p.auth.toString() + ';' +
      p.adapter.toString();
  });
  const injectionCode = baseStr + ';' + providerStrs.join(';');

  // Safeguard check on combined injection code
  checkSerialization(injectionCode, 'adapter-injection');

  // Build adapter branches
  const adapterBranches = adaptersWithCode.map(p => {
    const adapterName = p.adapter.name;
    return `if(P==="${p.runtimeId}"){return new ${MATCH.CONSTRUCTOR}({...M,apiKey:'${p.key}-placeholder',fetch:${adapterName}});}`;
  }).join('');

  patch('11-12-provider-adapters',
    MATCH.INJECT,
    `P=cX(_);${injectionCode};${adapterBranches}if(P==="bedrock")`
  );

  // ── Patch 15: Model defaults ──
  patch('15-model-defaults',
    MATCH.VERSION,
    MATCH.VERSION + '\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_SONNET_MODEL)process.env.ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-4-6";\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_OPUS_MODEL)process.env.ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-4-6";\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL)process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-haiku-4-5";'
  );

  // ── Patch 50: Context window env vars ──
  const ctxProviders = sorted.filter(p => p.contextWindow);
  if (ctxProviders.length > 0) {
    const ctxIife = '(function(){' +
      ctxProviders.map((p, i) => {
        const cond = i === 0 ? 'if' : 'else if';
        return `${cond}(process.env.${p.envKey}){` +
          'process.env.DISABLE_COMPACT=process.env.DISABLE_COMPACT||"1";' +
          `process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS=process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS||"${p.contextWindow.default}";` +
          '}';
      }).join('') +
      '})();\n';

    patch('50-context-window',
      MATCH.VERSION + '\n' + 'if(!process.env.ANTHROPIC_DEFAULT_SONNET_MODEL)',
      MATCH.VERSION + '\n' + ctxIife + 'if(!process.env.ANTHROPIC_DEFAULT_SONNET_MODEL)'
    );
  }

  // ── Patch 51: Default context fallback with per-model support ──
  if (ctxProviders.length > 0) {
    const ctxChain = ctxProviders.map(p => {
      const hasPerModel = p.contextWindow.perModel && Object.keys(p.contextWindow.perModel).length > 0;
      if (hasPerModel) {
        const perModelChecks = Object.entries(p.contextWindow.perModel)
          .map(([model, tokens]) => `(_cm&&_cm.includes("${model}"))?${tokens}`)
          .join(':');
        return `process.env.${p.envKey}?(function(){var _cm=typeof _==="string"?_:"";return ${perModelChecks}:${p.contextWindow.default}})()`;
      }
      return `process.env.${p.envKey}?${p.contextWindow.default}`;
    }).join(':');
    patch('51-default-context',
      MATCH.CONTEXT_DEFAULT,
      `xL1=(${ctxChain}:200000)`
    );
  }

  // ── Patch 60: Model display name ──
  const displayProviders = providers.filter(p => p.identity.modelDisplayNames);
  if (displayProviders.length > 0) {
    const displayBranches = displayProviders.map(p => {
      const names = p.identity.modelDisplayNames;
      const entries = Object.entries(names).filter(([k]) => k !== 'default');
      const checks = entries.map(([model, display]) =>
        `if(_m.includes("${model}"))return"${display}";`
      ).join('');
      return `if(dq()==="${p.runtimeId}"){let _m=q.toLowerCase();${checks}return"${names.default}";}`;
    }).join('');

    patch('60-model-display-name',
      MATCH.DISPLAY,
      `function y0(q){${displayBranches}if(dq()==="foundry")return;`
    );
  }

  // ── Patch 61: System prompt identity ──
  const identityBranches = providers
    .filter(p => p.runtimeId !== 'firstParty')
    .map(p => `if(_p==="${p.runtimeId}")return"${p.identity.systemPrompt}";`)
    .join('');
  const fallbackPrompt = fallback.identity.systemPrompt;
  patch('61-system-identity',
    MATCH.IDENTITY,
    `Bh1=(()=>{const _p=typeof dq==="function"?dq():"firstParty";${identityBranches}return"${fallbackPrompt}";})()`
  );

  // ── Patch 62: SDK identity ──
  const sdkPrompt = providers.find(p => p.identity.sdkPrompt)?.identity.sdkPrompt
    || 'You are Silly Code, a multi-provider AI coding assistant, running within the Agent SDK.';
  patch('62-sdk-identity',
    MATCH.SDK_ID,
    `z14="${sdkPrompt}"`
  );

  // ── Patch 64: Model ID in prompt ──
  patch('64-model-id-in-prompt',
    MATCH.MODEL_ID,
    'You are powered by the model named ${$}.'
  );

  // ── Patch 65: Agent identity ──
  const agentBranches = providers
    .filter(p => p.runtimeId !== 'firstParty')
    .map(p => `if(_p==="${p.runtimeId}")return"${p.identity.agentPrompt}";`)
    .join('');
  const fallbackAgent = fallback.identity.agentPrompt;
  patch('65-agent-identity',
    MATCH.AGENT_ID,
    `Y14=(()=>{const _p=typeof dq==="function"?dq():"firstParty";${agentBranches}return"${fallbackAgent}";})()`
  );

  // ── Patch 63a: Simple identity ──
  const simpleBranches = providers
    .filter(p => p.runtimeId !== 'firstParty')
    .map(p => `if(_p==="${p.runtimeId}")return"${p.identity.simplePrompt}";`)
    .join('');
  const fallbackSimple = fallback.identity.simplePrompt;
  const longBranches = providers
    .filter(p => p.runtimeId !== 'firstParty')
    .map(p => `if(_p==="${p.runtimeId}")return"${p.identity.systemPrompt}";`)
    .join('');
  patch('63a-prompt-simple-identity',
    MATCH.SIMPLE_ID,
    `?(()=>{const _p=typeof dq==="function"?dq():"firstParty";${simpleBranches}return"${fallbackSimple}";})()`
    + `:((()=>{const _p=typeof dq==="function"?dq():"firstParty";${longBranches}return"${fallbackPrompt}";})())+\``
  );

  // ── Patch 63: Tier display ──
  const tierLevels = ['max', 'pro', 'api'];
  const tierCases = tierLevels.map((level) => {
    const branches = providers
      .filter(p => p.runtimeId !== 'firstParty')
      .map(p => `(typeof dq==="function"&&dq()==="${p.runtimeId}")?"${p.tierNames[level]}"`)
      .join(':');
    const fallbackTier = fallback.tierNames[level];
    const prefix = level === 'api' ? 'default' : `case"${level}"`;
    return `${prefix}:return ${branches}:"${fallbackTier}"`;
  });
  patch('63-tier-display',
    MATCH.TIER,
    tierCases.join(';')
  );

  // ── Patch report ──
  const providerList = providers.map(p => p.key).join(', ');
  const adapterCount = adaptersWithCode.length;
  const identityCount = providers.length;
  console.log(`\n  PATCH REPORT (provider-engine)`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  10-provider-detection    ${sorted.length} providers in chain`);
  console.log(`  11-12-provider-adapters  ${adapterCount} adapters injected (${adaptersWithCode.map(p=>p.key).join(', ')})`);
  console.log(`  13-14-resolution/family  ${allRuntimeIds.length} runtimeIds added`);
  if (ctxProviders.length > 0) console.log(`  50-51-context-window     ${ctxProviders.length} providers with custom context`);
  console.log(`  60-65-identity           ${identityCount} identity branches`);
  console.log(`  63/63a-tier/simple       ${providers.filter(p=>p.runtimeId!=='firstParty').length} non-default providers`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  providers: ${providerList}`);
};
