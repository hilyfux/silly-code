// Provider-aware UX: context window, menu, "/model" heading.
// MUST run after provider-core — patch 50 anchors on patch 15 output.

const { MATCH } = require('../match-registry.cjs');
const { sorted } = require('./_providers.cjs');

module.exports = function applyProviderUx({ patch }) {
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
      `AE6=(${ctxChain}:200000)`
    );
  }

  // ── Patch 52: Clamp non-Opus-4.7 1M context on firstParty ──
  patch('52-clamp-1m-non-opus-47',
    'if(A2(H))return 1e6;',
    'if(A2(H)){var _1m=H?H.toLowerCase():"";if(uq()==="firstParty"&&_1m.indexOf("opus-4-7")===-1&&!EH(process.env.SILLY_ENABLE_1M_CONTEXT))return AE6;return 1e6}'
  );

  // ── Patch 52b: Do NOT advertise context-1m beta for non-Opus-4.7 firstParty ──
  patch('52b-no-1m-beta-non-opus-47',
    'if(A2(H))_.push(Ro);',
    'if(A2(H)){var _1mb=H?H.toLowerCase():"";if(!(uq()==="firstParty"&&_1mb.indexOf("opus-4-7")===-1&&!EH(process.env.SILLY_ENABLE_1M_CONTEXT)))_.push(Ro);}'
  );

  // Patch 53 family: Opus 4.7 + Codex menu, branch-independent.
  // Why: Patch 21 forces Hq()==true, so z85 returns at the Hq() branches
  // and never reaches the fall-through. Inject at z85 entry (openai
  // early-return + _sO47 helper) and wrap every return with _sO47(...)
  // so Opus 4.7 appears regardless of which internal branch fires.
  const gptList = '[{value:"gpt-5.4",label:"gpt-5.4",description:"Latest frontier agentic coding model"},{value:"gpt-5.2-codex",label:"gpt-5.2-codex",description:"Frontier agentic coding model (\\u2192 gpt-5.4)"},{value:"gpt-5.1-codex-max",label:"gpt-5.1-codex-max",description:"Codex-optimized flagship for deep and fast reasoning (\\u2192 gpt-5.4)"},{value:"gpt-5.4-mini",label:"gpt-5.4-mini",description:"Smaller frontier agentic coding model"},{value:"gpt-5.3-codex",label:"gpt-5.3-codex",description:"Frontier Codex-optimized agentic coding model"},{value:"gpt-5.3-codex-spark",label:"gpt-5.3-codex-spark",description:"Ultra-fast coding model (\\u2192 gpt-5.3-codex)"},{value:"gpt-5.2",label:"gpt-5.2",description:"Optimized for professional work and long-running agents (\\u2192 gpt-5.4)"},{value:"gpt-5.1-codex-mini",label:"gpt-5.1-codex-mini",description:"Optimized for codex. Cheaper, faster, but less capable (\\u2192 gpt-5.4)"}]';
  const opus47Item = '{value:"claude-opus-4-7",label:"Opus 4.7",description:"Opus 4.7 \\xB7 Most capable for complex work"}';

  patch('53-menu-entry',
    'function z85(H=!1){',
    `function z85(H=!1){if(typeof uq==="function"&&uq()==="openai")return ${gptList};var _sO47=function(x){if(!x.some(function(y){return y&&y.value==="claude-opus-4-7"}))x.push(${opus47Item});return x};`
  );
  patch('53c-menu-hq-sub',
    'return $.push(l$7),$',
    'return _sO47(($.push(l$7),$))'
  );
  patch('53d-menu-hq-default',
    'return T.push(l$7),T',
    'return _sO47((T.push(l$7),T))'
  );
  patch('53e-menu-pro',
    'return T.push(r$7()),T',
    'return _sO47((T.push(r$7()),T))'
  );
  patch('53f-menu-fallthrough',
    '_.push(T85());return _',
    '_.push(T85());return _sO47(_)'
  );

  // Patch 53b: skip additionalModelOptionsCache — it leaks models across
  // providers (gpt-5.4 surfacing in Claude menu, and vice versa).
  patch('53b-no-model-cache',
    'for(let A of w_().additionalModelOptionsCache??[])if(!_.some((z)=>z.value===A.value))_.push(A);',
    'void 0;'
  );

  // ── Patch 54: q_6 fallback short-circuit for openai ──
  patch('54-menu-fallback-openai-skip',
    '||_.some((A)=>A.value===O))return BMH(_);else if(O==="opusplan")',
    '||_.some((A)=>A.value===O))return BMH(_);if(typeof uq==="function"&&uq()==="openai")return BMH(_);else if(O==="opusplan")'
  );

  // Patch 55b: drop cross-provider "Current model" row — after sillyx→sillyes
  // the persisted GPT value would otherwise surface in the Claude picker.
  patch('55b-no-cross-provider-current',
    'if(q!==null&&!E.some((dH)=>dH.value===q)){let dH;',
    'if(q!==null&&!E.some((dH)=>dH.value===q)&&!(typeof uq==="function"&&((uq()==="firstParty"&&q&&q.startsWith("gpt-"))||(uq()==="openai"&&q&&!q.startsWith("gpt-"))))){let dH;'
  );

  // ── Patch 55: "/model" heading for openai ──
  patch('55-model-heading-openai',
    'z??"Switch between Claude models. Applies to this session and future Claude Code sessions. For other/previous model names, specify with --model."',
    'z??((typeof uq==="function"&&uq()==="openai")?"Select a Codex model. Access legacy models by running sillyx --model <model_name>.":"Switch between Claude models. Applies to this session and future Claude Code sessions. For other/previous model names, specify with --model.")'
  );

  // Patch 56: cross-provider persisted-model guard in db().
  // Why: sillye + sillyx share $HOME/.silly-code/settings.json, so model
  // selection leaks between providers and surfaces in the boot banner
  // (55b only filters the picker row). Drop any persisted model whose
  // prefix doesn't match the active provider so hK() falls back to gJ().
  patch('56-model-parity-filter',
    'function db(){let H,_=dC();if(_!==void 0)H=_;else{let q=C8()||{};H=process.env.ANTHROPIC_MODEL||q.model||void 0}if(H&&!MqH(H))return;return H}',
    'function db(){let H,_=dC();if(_!==void 0)H=_;else{let q=C8()||{};H=process.env.ANTHROPIC_MODEL||q.model||void 0}if(H&&!MqH(H))return;if(H&&typeof uq==="function"){var _p=uq(),_isGpt=typeof H==="string"&&H.toLowerCase().startsWith("gpt-");if((_p==="firstParty"&&_isGpt)||(_p==="openai"&&!_isGpt))return}return H}'
  );
};
