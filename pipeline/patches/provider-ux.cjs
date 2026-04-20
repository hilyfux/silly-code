/**
 * provider-ux.cjs — Provider-aware UX patches
 *
 * Patches: 50, 51, 52, 52b, 53, 54, 55
 * Pillar: Dual-Provider (Claude + Codex)
 *
 * Changes when: upstream menu UI changes, OpenAI adds/deprecates models,
 * or context window logic changes. Independent of core injection (10-15)
 * and identity (60-67).
 *
 * Ordering: MUST run after provider-core (patch 50 anchors on patch 15 output).
 */

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
      `DR1=(${ctxChain}:200000)`
    );
  }

  // ── Patch 52: Clamp non-Opus-4.7 1M context on firstParty ──
  patch('52-clamp-1m-non-opus-47',
    'if(DP(q))return 1e6;',
    'if(DP(q)){var _1m=q?q.toLowerCase():"";if(pq()==="firstParty"&&_1m.indexOf("opus-4-7")===-1&&!S6(process.env.SILLY_ENABLE_1M_CONTEXT))return DR1;return 1e6}'
  );

  // ── Patch 52b: Do NOT advertise context-1m beta for non-Opus-4.7 firstParty ──
  patch('52b-no-1m-beta-non-opus-47',
    'if(DP(q))K.push(Zo);',
    'if(DP(q)){var _1mb=q?q.toLowerCase():"";if(!(pq()==="firstParty"&&_1mb.indexOf("opus-4-7")===-1&&!S6(process.env.SILLY_ENABLE_1M_CONTEXT)))K.push(Zo);}'
  );

  // ── Patch 53: Opus 4.7 + Opus 4.6 options + native Codex menu for sillyx ──
  // Use direct model ID "claude-opus-4-7" (not alias "opus") to bypass
  // alias resolution chain that can misroute to opus46.
  patch('53-model-menu',
    'O.push(xvK),O',
    'O.push(xvK),O.push({value:"claude-opus-4-7",label:"Opus 4.7",description:"Opus 4.7 \xB7 Most capable for complex work"}),O.push(uvK(q,!1)),pq()!=="openai"?O:[{value:"gpt-5.4",label:"gpt-5.4",description:"Latest frontier agentic coding model"},{value:"gpt-5.2-codex",label:"gpt-5.2-codex",description:"Frontier agentic coding model (→ gpt-5.4)"},{value:"gpt-5.1-codex-max",label:"gpt-5.1-codex-max",description:"Codex-optimized flagship for deep and fast reasoning (→ gpt-5.4)"},{value:"gpt-5.4-mini",label:"gpt-5.4-mini",description:"Smaller frontier agentic coding model"},{value:"gpt-5.3-codex",label:"gpt-5.3-codex",description:"Frontier Codex-optimized agentic coding model"},{value:"gpt-5.3-codex-spark",label:"gpt-5.3-codex-spark",description:"Ultra-fast coding model (→ gpt-5.3-codex)"},{value:"gpt-5.2",label:"gpt-5.2",description:"Optimized for professional work and long-running agents (→ gpt-5.4)"},{value:"gpt-5.1-codex-mini",label:"gpt-5.1-codex-mini",description:"Optimized for codex. Cheaper, faster, but less capable (→ gpt-5.4)"}]'
  );

  // ── Patch 53b: Disable additionalModelOptionsCache in menu ──
  // The bootstrap cache leaks models across providers (gpt-5.4 in Claude menu,
  // sonnet in Codex menu). Since our menus are already comprehensive via
  // patches 53/25, skip the cache entirely.
  patch('53b-no-model-cache',
    'for(let w of H8().additionalModelOptionsCache??[])if(!K.some(($)=>$.value===w.value))K.push(w);',
    'void 0;'
  );

  // ── Patch 54: q_6 fallback short-circuit for openai ──
  patch('54-menu-fallback-openai-skip',
    '||K.some((w)=>w.value===Y))return RM6(K);else if(Y==="opusplan")',
    '||K.some((w)=>w.value===Y))return RM6(K);if(typeof pq==="function"&&pq()==="openai")return RM6(K);else if(Y==="opusplan")'
  );

  // ── Patch 55b: Block cross-provider "Current model" in picker ──
  // When switching from sillyx→sillyes, the persisted model (e.g. gpt-5.1-codex-mini)
  // leaks into the Claude menu as "Current model". Block GPT models in firstParty
  // and Claude models in openai.
  patch('55b-no-cross-provider-current',
    'if(_!==null&&!R.some((p6)=>p6.value===_)){let p6;',
    'if(_!==null&&!R.some((p6)=>p6.value===_)&&!(typeof pq==="function"&&((pq()==="firstParty"&&_&&_.startsWith("gpt-"))||(pq()==="openai"&&_&&!_.startsWith("gpt-"))))){let p6;'
  );

  // ── Patch 55: "/model" heading for openai ──
  patch('55-model-heading-openai',
    '$??"Switch between Claude models. Applies to this session and future Claude Code sessions. For other/previous model names, specify with --model."',
    '$??((typeof pq==="function"&&pq()==="openai")?"Select a Codex model. Access legacy models by running sillyx --model <model_name>.":"Switch between Claude models. Applies to this session and future Claude Code sessions. For other/previous model names, specify with --model.")'
  );
};
