# Provider Modularization Design

Date: 2026-04-11

## Problem

Provider adaptation logic is scattered across 4 patch files (providers.cjs, identity.cjs, platform.cjs, branding.cjs) with overlapping responsibilities. Adding a new provider requires coordinated edits in 3+ files. Upstream upgrades require fixing the same match string patterns in multiple places.

## Goal

Modularize the three provider adaptations (Claude, OpenAI/Codex, Copilot) into a plugin architecture where:
- Each provider is a self-contained file declaring its configuration and unique logic
- A shared engine generates all patches from provider configs
- The upstream Claude Code binary serves as the base with all capabilities preserved
- Adding a new provider = adding one file, zero changes to existing code

## Architecture

```
patches/
  branding.cjs                ← unchanged (brand URLs, mascot, version)
  equality.cjs                ← unchanged (tier bypass)
  privacy.cjs                 ← unchanged (telemetry blocking)

  provider-engine.cjs         ← NEW: loads providers/, generates all provider-related patches
  providers/
    _base.cjs                 ← NEW: shared protocol translation (msg conversion, SSE, tool schema)
    claude.cjs                ← NEW: Claude config (default provider, minimal — base is the binary itself)
    openai.cjs                ← NEW: OpenAI/Codex config + adapter (OAuth, API key dual-path, Responses API)
    copilot.cjs               ← NEW: Copilot config + adapter (GitHub token refresh, vscode headers)
```

### Data Flow

```
patch.cjs (orchestrator)
  ├── branding.cjs            → direct patch calls
  ├── provider-engine.cjs     → loads providers/*.cjs, generates:
  │     │                        - patch 10: provider detection (env var chain)
  │     │                        - patch 11-12: adapter injection (serialized)
  │     │                        - patch 13-14: model resolution / family expansion
  │     │                        - patch 50-51: context window (per-provider)
  │     │                        - patch 60-65: identity (per-provider)
  │     │                        - patch 63: tier display (per-provider)
  │     ├── claude.cjs          → { config }
  │     ├── openai.cjs          → { config, adapter, auth }
  │     └── copilot.cjs         → { config, adapter, auth }
  ├── equality.cjs            → direct patch calls
  └── privacy.cjs             → direct patch calls
```

## Provider Interface

Every provider file exports a single object with this structure:

```javascript
module.exports = {
  name: 'openai',                          // provider identifier (used in dq() return value)
  envKey: 'CLAUDE_CODE_USE_OPENAI',        // env var that activates this provider (null = default)

  identity: {
    displayName: 'OpenAI GPT',             // TUI title bar display (null = use upstream default)
    systemPrompt: 'You are Silly Code, running with OpenAI GPT.',
    agentPrompt: 'You are a Silly Code agent, running with OpenAI GPT.',
    simplePrompt: 'You are Silly Code (OpenAI GPT).',
  },

  models: {                                // Claude model name → this provider's model name
    'claude-opus': 'gpt-5.4',             // (null = no mapping, use original model names)
    'claude-sonnet': 'gpt-5.4',
    'claude-haiku': 'gpt-5.3-codex',
    default: 'gpt-5.4',
  },

  contextWindow: 128000,                   // max context tokens (null = upstream default 200K)

  tierNames: {                             // subscription tier display names
    max: 'ChatGPT Pro',
    pro: 'ChatGPT Plus',
    api: 'OpenAI API',
  },

  adapter: null,                           // custom fetch adapter function (null = use native Anthropic SDK)
  auth: null,                              // custom auth/token refresh logic (null = use upstream auth)
}
```

### Claude Provider (Minimal)

```javascript
// providers/claude.cjs
module.exports = {
  name: 'claude',
  envKey: null,                            // default provider, no env var needed
  identity: {
    displayName: null,                     // null = use upstream Claude display names
    systemPrompt: 'You are Silly Code, running with Claude.',
    agentPrompt: 'You are a Silly Code agent, running with Claude.',
    simplePrompt: 'You are Silly Code (Claude).',
  },
  models: null,                            // no mapping, use original Claude model names
  contextWindow: null,                     // use upstream 200K default
  tierNames: { max: 'Claude Max', pro: 'Claude Pro', api: 'Claude API' },
  adapter: null,                           // no fetch interception, native Anthropic SDK
  auth: null,
}
```

## Shared Base (`_base.cjs`)

Extracted from current providers.cjs. Contains protocol translation functions shared by all non-Claude providers:

| Function | Purpose |
|----------|---------|
| `msgToOai(msg)` | Anthropic message content → OpenAI format (tool_use → tool_calls, tool_result → tool role) |
| `msgsToResponsesInput(system, msgs)` | Anthropic messages → Responses API input format |
| `makeSseStream(resp, model)` | OpenAI Chat Completions SSE → Anthropic Messages SSE |
| `makeResponsesSseStream(resp, model)` | OpenAI Responses API SSE → Anthropic Messages SSE |
| `mapModel(model, modelTable)` | Map Claude model name using provider's model table |

These functions are serialized as strings and injected into the binary alongside the provider adapters. They remain string-injected (required to run in the upstream client factory scope).

## Provider Engine (`provider-engine.cjs`)

Responsibilities:
1. Load all `providers/*.cjs` files (skip `_base.cjs`)
2. Generate patch calls from aggregated provider configs:

### Match String Constants

All upstream binary match strings are declared at the top of the engine:

```javascript
const MATCH = {
  DETECT:      'return F6(process.env.CLAUDE_CODE_USE_BEDROCK)?"bedrock"',
  INJECT:      'P=cX(_);if(P==="bedrock")',
  RESOLVE:     'function D$(q=dq()){return q==="firstParty"||q==="anthropicAws"}',
  FAMILY:      'function lg(q=dq()){return q==="firstParty"||q==="anthropicAws"||q==="foundry"||q==="mantle"}',
  CONTEXT:     'xL1=2e5',
  DISPLAY:     'function y0(q){if(dq()==="foundry")return;',
  IDENTITY:    'Bh1="You are Claude Code, Anthropic\\\'s official CLI for Claude."',
  SDK_ID:      'z14="You are Claude Code, Anthropic\\\'s official CLI for Claude, running within the Claude Agent SDK."',
  AGENT_ID:    'Y14="You are a Claude agent, built on Anthropic\\\'s Claude Agent SDK."',
  MODEL_ID:    'You are powered by the model named ${$}. The exact model ID is ${q}.',
  SIMPLE_ID:   '?"You are Claude Code, Anthropic\\\'s official CLI for Claude.":`You are Claude Code, Anthropic\\\'s official CLI for Claude.',
  TIER:        'case"max":return"Claude Max";case"pro":return"Claude Pro";default:return"Claude API"',
  CONSTRUCTOR: 'gL',
}
```

**Upstream upgrade workflow: only update these constants.** The engine code and provider configs remain unchanged.

### Patch Generation

The engine iterates over loaded providers to generate each patch:

- **Detection (patch 10):** Build ternary chain from all providers with `envKey`
- **Adapters (patch 11-12):** Serialize `_base.cjs` + each provider's `adapter` function, inject before bedrock branch
- **Resolution (patch 13-14):** Extend firstParty check with all provider names
- **Context (patch 50-51):** Generate env-var-based context window selection from `contextWindow` values
- **Identity (patches 60-65):** Generate provider-aware strings from `identity` configs using `dq()` switch
- **Tier (patch 63):** Generate tier name switch from `tierNames` configs

## Patch Inventory (Before → After)

| Current File | Current Patches | After |
|-------------|----------------|-------|
| branding.cjs | 01-07a | unchanged |
| providers.cjs | 10-15 | → provider-engine.cjs + providers/*.cjs |
| identity.cjs | 60-65, 63a | → provider-engine.cjs (generated from config) |
| platform.cjs | 50-51 | → provider-engine.cjs (generated from config) |
| equality.cjs | 20-21 | unchanged |
| privacy.cjs | 30-39 | unchanged |

Files removed: providers.cjs, identity.cjs, platform.cjs (merged into engine + config)

## Upgrade Flow (Simplified)

Before (current):
```
upstream update → 14+ patches break → fix match strings in 6 files
                → find new variable names → update providers.cjs, identity.cjs, platform.cjs separately
```

After:
```
upstream update → patches break → update MATCH constants in provider-engine.cjs (one file)
               → rebuild → done
```

## Adding a New Provider

1. Create `providers/newprovider.cjs` with the standard interface
2. `node pipeline/patch.cjs` — engine auto-discovers and includes it
3. No changes to engine, base, or other providers

## Constraints

- Adapter functions remain string-serialized (must run in upstream client factory scope)
- `_base.cjs` functions are serialized alongside adapters (same scope constraint)
- Provider files are regular Node.js modules (not serialized, run at build time only)
- `patch.cjs` orchestrator load order: branding → provider-engine → equality → privacy
- Claude provider's `adapter: null` means zero fetch interception — full native capability

## Testing

After rebuild (`node pipeline/patch.cjs`), verify all three providers:

```bash
# Claude (native)
node pipeline/build/cli-patched.js -p "Name? Model?"

# OpenAI
CLAUDE_CODE_USE_OPENAI=1 SILLY_CODE_DATA=~/.silly-code \
  node pipeline/build/cli-patched.js -p "Name? Model?"

# Copilot
CLAUDE_CODE_USE_COPILOT=1 SILLY_CODE_DATA=~/.silly-code \
  node pipeline/build/cli-patched.js -p "Name? Model?"
```

Expected: each reports "Silly Code" with its own model name.
