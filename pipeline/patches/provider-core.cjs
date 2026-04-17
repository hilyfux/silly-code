/**
 * provider-core.cjs — Core provider detection + adapter injection
 *
 * Patches: 10, 13, 14, 11-12, 15
 * Pillar: Dual-Provider (Claude + Codex)
 *
 * Changes when: a new provider is added/removed, adapter serialization
 * logic changes, or model defaults change.
 */

const fs = require('fs');
const path = require('path');
const { MATCH, verifyAnchors } = require('../match-registry.cjs');
const { base, providers, sorted, fallback, allRuntimeIds } = require('./_providers.cjs');

function checkSerialization(code, label) {
  if (/\brequire\s*\(/.test(code)) throw new Error(`${label}: bare require() detected`);
  if (/\b(module|exports|__dirname|__filename)\b/.test(code)) throw new Error(`${label}: module-scope reference detected`);
  const importMatches = code.match(/import\s*\([^)]+\)/g) || [];
  for (const im of importMatches) {
    if (!im.includes("'node:") && !im.includes('"node:')) throw new Error(`${label}: non-node: import detected: ${im}`);
  }
  try {
    const mockFetch = () => Promise.resolve(new Response('{}', { status: 200 }));
    new Function('fetch', code)(mockFetch);
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof TypeError) {
      throw new Error(`${label}: execution verification failed — ${e.message}`);
    }
  }
}

function applyProviderCore({ patch }) {
  verifyAnchors(fs.readFileSync(path.join(__dirname, '..', 'upstream/package/cli.js'), 'utf8'));

  // ── Patch 10: Provider detection ──
  const detectChain = sorted.map(p =>
    `S6(process.env.${p.envKey})?"${p.runtimeId}"`
  ).join(':');
  patch('10-provider-detection',
    MATCH.DETECT,
    'return ' + detectChain + ':' + MATCH.DETECT.replace('return ', '')
  );

  // ── Patch 13: Model resolution ──
  const runtimeIdExt = allRuntimeIds.map(id => `||q==="${id}"`).join('');
  patch('13-model-resolution',
    MATCH.RESOLVE,
    MATCH.RESOLVE.replace(
      'q==="firstParty"||q==="anthropicAws"}',
      'q==="firstParty"||q==="anthropicAws"' + runtimeIdExt + '}'
    )
  );

  // ── Patch 14: Provider family ──
  patch('14-provider-family',
    MATCH.FAMILY,
    MATCH.FAMILY.replace(
      'q==="foundry"||q==="mantle"}',
      'q==="foundry"||q==="mantle"' + runtimeIdExt + '}'
    )
  );

  // ── Patches 11-12: Adapter injection ──
  const adaptersWithCode = providers.filter(p => p.adapter);
  const baseStr = Object.values(base).map(f => f.toString()).join(';');
  const providerStrs = adaptersWithCode.map(p => {
    let adapterStr = p.adapter.toString();
    if (p._injectableData) {
      for (const [name, data] of Object.entries(p._injectableData)) {
        const sentinel = `"__INJECT_${name}__"`;
        if (!adapterStr.includes(sentinel)) {
          throw new Error(`${p.key}: sentinel ${sentinel} not found in adapter function`);
        }
        adapterStr = adapterStr.replace(sentinel, JSON.stringify(data));
      }
    }
    return `let _${p.key}Data=null;` +
      p.auth.toString() + ';' +
      adapterStr;
  });
  const injectionCode = baseStr + ';' + providerStrs.join(';');
  checkSerialization(injectionCode, 'adapter-injection');

  const adapterBranches = adaptersWithCode.map(p => {
    const adapterName = p.adapter.name;
    return `if(P==="${p.runtimeId}"){return new ${MATCH.CONSTRUCTOR}({...M,apiKey:'${p.key}-placeholder',fetch:${adapterName}});}`;
  }).join('');

  patch('11-12-provider-adapters',
    MATCH.INJECT,
    `P=YM(_);${injectionCode};${adapterBranches}if(P==="bedrock")`
  );

  // ── Patch 15: Model defaults ──
  patch('15-model-defaults',
    MATCH.VERSION,
    MATCH.VERSION + '\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_SONNET_MODEL)process.env.ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-4-6";\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_OPUS_MODEL)process.env.ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-4-6";\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL)process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-haiku-4-5";'
  );
}

applyProviderCore.checkSerialization = checkSerialization;
module.exports = applyProviderCore;
