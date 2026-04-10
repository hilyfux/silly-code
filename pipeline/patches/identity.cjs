/**
 * identity.cjs — Patches 60-63: Provider-aware identity
 *
 * When running as openai/copilot provider, the model should know
 * it's running on GPT/Copilot, not Claude. This patches:
 * - G0: model display name in TUI header
 * - Xh1/f64/T64: system prompt identity declaration
 * - MT8: subscription tier display
 */

module.exports = function applyIdentity({ patch }) {
  // Patch 60: G0 — model display name for TUI title bar
  // Prepend provider-aware branch before the existing Claude model mapping
  patch('60-model-display-name',
    'function G0(q){if(dq()==="foundry")return;',
    'function G0(q){' +
    'if(dq()==="openai"){' +
      'let _m=q.toLowerCase();' +
      'if(_m.includes("gpt-5.4-mini"))return"GPT 5.4 Mini";' +
      'if(_m.includes("gpt-5.4"))return"GPT 5.4";' +
      'if(_m.includes("gpt-5.3-codex"))return"GPT 5.3 Codex";' +
      'if(_m.includes("gpt-4o-mini"))return"GPT 4o Mini";' +
      'if(_m.includes("gpt-4o"))return"GPT 4o";' +
      'if(_m.includes("o3"))return"o3";' +
      // Mapped models: when Claude model names are mapped to GPT
      'if(_m.includes("claude-opus"))return"GPT 5.4";' +
      'if(_m.includes("claude-sonnet"))return"GPT 5.4";' +
      'if(_m.includes("claude-haiku"))return"GPT 5.3 Codex";' +
      'return"GPT 5.4";' +
    '}' +
    'if(dq()==="copilot"){' +
      'let _m=q.toLowerCase();' +
      'if(_m.includes("claude-opus"))return"GPT 4o (Copilot)";' +
      'if(_m.includes("claude-sonnet"))return"GPT 4o (Copilot)";' +
      'if(_m.includes("claude-haiku"))return"GPT 4o Mini (Copilot)";' +
      'if(_m.includes("gpt-4o-mini"))return"GPT 4o Mini (Copilot)";' +
      'if(_m.includes("gpt-4o"))return"GPT 4o (Copilot)";' +
      'if(_m.includes("o3"))return"o3 (Copilot)";' +
      'return"GPT 4o (Copilot)";' +
    '}' +
    'if(dq()==="foundry")return;'
  )

  // Patch 61: System prompt identity — make it provider-aware
  patch('61-system-identity',
    'Xh1="You are Claude Code, Anthropic\'s official CLI for Claude."',
    'Xh1=(()=>{' +
      'const _p=typeof dq==="function"?dq():"firstParty";' +
      'if(_p==="openai")return"You are Silly Code, a multi-provider AI coding assistant, currently running with OpenAI GPT as the backend model.";' +
      'if(_p==="copilot")return"You are Silly Code, a multi-provider AI coding assistant, currently running with GitHub Copilot as the backend model.";' +
      'return"You are Silly Code, a multi-provider AI coding assistant, currently running with Claude as the backend model.";' +
    '})()'
  )

  // Patch 62: SDK identity string
  patch('62-sdk-identity',
    'f64="You are Claude Code, Anthropic\'s official CLI for Claude, running within the Claude Agent SDK."',
    'f64="You are Silly Code, a multi-provider AI coding assistant, running within the Agent SDK."'
  )

  // Patch 64: Model identity in system prompt — hide internal claude model ID for non-Claude providers
  // Original: "The exact model ID is ${q}" where q = "claude-opus-4-6" (confuses GPT)
  // Patched: show display name instead of internal ID for openai/copilot
  patch('64-model-id-in-prompt',
    'You are powered by the model named ${$}. The exact model ID is ${q}.',
    'You are powered by the model named ${$}.'
  )

  // Patch 65: Agent identity (T64) — "Claude agent" → provider-aware
  patch('65-agent-identity',
    'T64="You are a Claude agent, built on Anthropic\'s Claude Agent SDK."',
    'T64=(()=>{const _p=typeof dq==="function"?dq():"firstParty";' +
      'if(_p==="openai")return"You are a Silly Code agent, running with OpenAI GPT.";' +
      'if(_p==="copilot")return"You are a Silly Code agent, running with GitHub Copilot.";' +
      'return"You are a Silly Code agent, running with Claude.";})()'
  )

  // Patch 63a: System prompt template — simple mode identity
  patch('63a-prompt-simple-identity',
    '?"You are Claude Code, Anthropic\'s official CLI for Claude.":`You are Claude Code, Anthropic\'s official CLI for Claude.',
    '?(()=>{const _p=typeof dq==="function"?dq():"firstParty";if(_p==="openai")return"You are Silly Code (OpenAI GPT).";if(_p==="copilot")return"You are Silly Code (GitHub Copilot).";return"You are Silly Code (Claude).";})()'
    +':((()=>{const _p=typeof dq==="function"?dq():"firstParty";if(_p==="openai")return"You are Silly Code, a multi-provider AI coding assistant running with OpenAI GPT.";if(_p==="copilot")return"You are Silly Code, a multi-provider AI coding assistant running with GitHub Copilot.";return"You are Silly Code, a multi-provider AI coding assistant running with Claude.";})())+`'
  )

  // Patch 63: Subscription tier display
  patch('63-tier-display',
    'case"max":return"Claude Max";case"pro":return"Claude Pro";default:return"Claude API"',
    'case"max":return(typeof dq==="function"&&dq()==="openai")?"ChatGPT Pro":(typeof dq==="function"&&dq()==="copilot")?"Copilot Pro":"Claude Max";' +
    'case"pro":return(typeof dq==="function"&&dq()==="openai")?"ChatGPT Plus":(typeof dq==="function"&&dq()==="copilot")?"Copilot":"Claude Pro";' +
    'default:return(typeof dq==="function"&&dq()==="openai")?"OpenAI API":(typeof dq==="function"&&dq()==="copilot")?"Copilot API":"Claude API"'
  )
}
