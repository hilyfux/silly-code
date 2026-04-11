# Provider Modularization Design

Date: 2026-04-11

## Problem

Provider adaptation logic is scattered across 3 patch files (providers.cjs, identity.cjs, platform.cjs) with overlapping responsibilities. Each file independently checks provider state and hardcodes provider-specific values. Adding a new provider requires coordinated edits in all 3 files. Upstream upgrades require fixing the same match string patterns in multiple places.

## Goal

Modularize the three provider adaptations (Claude, OpenAI/Codex, Copilot) into a single-engine governed provider system where:
- Each provider is a self-contained file declaring its configuration and unique logic
- A shared engine generates all patches from provider configs
- The upstream Claude Code binary serves as the base with all capabilities preserved
- Adding a new provider = adding one file, **if it falls within the existing capability model** (same auth flow shape, same streaming protocol, same tool calling convention). Providers requiring new protocol shapes will also need `_base.cjs` or engine extensions.

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
  │     │                        - patch 60-62, 64-65: identity prompts (per-provider)
  │     │                        - patch 63, 63a: tier display + simple identity (per-provider)
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
  key: 'openai',                           // internal provider identifier (unique, used in config/logging)
  runtimeId: 'openai',                     // value returned by dq() at runtime (injected into binary)
  envKey: 'CLAUDE_CODE_USE_OPENAI',        // env var that activates this provider (null = default)
  priority: 10,                            // detection order (lower = checked first; null = default/fallback)

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

  contextWindow: {                         // max context tokens (canonical form)
    default: 128000,                       // provider-level default
    perModel: {},                          // optional: per-model override, e.g. { 'gpt-5.4': 128000 }
  },
  // Shorthand: contextWindow: 128000 is accepted as input
  // but normalized to { default: 128000, perModel: {} } at build time.
  // null means "use upstream default (200K)".

  tierNames: {                             // subscription tier display names
    max: 'ChatGPT Pro',
    pro: 'ChatGPT Plus',
    api: 'OpenAI API',
  },

  adapter: null,                           // custom fetch adapter function (null = use native Anthropic SDK)
  auth: null,                              // custom auth/token refresh logic (null = use upstream auth)
}
```

### Detection Priority & Conflict Resolution

When multiple provider env vars are set simultaneously, detection order is determined by `priority` (lower number = checked first). The first matching env var wins. Providers without `envKey` (i.e. Claude) are always the fallback.

```
priority 10: openai  (CLAUDE_CODE_USE_OPENAI)
priority 20: copilot (CLAUDE_CODE_USE_COPILOT)
priority null: claude (default fallback)
```

The engine sorts providers by priority and generates the ternary chain in that order. If two providers share the same priority, build fails with a conflict error.

### Claude Provider (Minimal)

```javascript
// providers/claude.cjs
module.exports = {
  key: 'claude',                           // internal identifier
  runtimeId: 'firstParty',                // upstream's default dq() value — no patch needed
  envKey: null,                            // default provider, no env var needed
  priority: null,                          // always fallback
  identity: {
    displayName: null,                     // null = use upstream Claude display names
    systemPrompt: 'You are Silly Code, running with Claude.',
    agentPrompt: 'You are a Silly Code agent, running with Claude.',
    simplePrompt: 'You are Silly Code (Claude).',
  },
  models: null,                            // no mapping, use original Claude model names
  contextWindow: null,                     // null = use upstream 200K default
  tierNames: { max: 'Claude Max', pro: 'Claude Pro', api: 'Claude API' },
  adapter: null,                           // no fetch interception, native Anthropic SDK
  auth: null,
}
```

## Adapter & Auth Contract

### adapter(url, init) → Response

The adapter function replaces the native `fetch` in the Anthropic SDK client. It receives the same arguments as `fetch` and must return a `Response` object that the SDK can consume.

```
Input:
  url:  string — the Anthropic API URL (ignored; adapter routes to its own endpoint)
  init: { method, headers, body } — body is JSON string in Anthropic Messages API format
        body contains: { model, system, messages, tools, stream, max_tokens, ... }

Output:
  Response object with either:
    - streaming: status 200, Content-Type text/event-stream, body is ReadableStream of Anthropic SSE
    - non-streaming: status 200, Content-Type application/json, body is Anthropic message JSON

Error:
  throw Error('Provider API error <status>: <body>')
  — errors propagate to upstream error handling, surfaced to user as API errors
```

The adapter is responsible for:
1. Calling `auth()` to get a valid token
2. Converting Anthropic request format to provider's format (using `_base.cjs` helpers)
3. Making the fetch to the provider's endpoint
4. Converting the provider's response back to Anthropic format (using `_base.cjs` SSE translators)

The adapter must NOT:
- Reference variables outside its own function scope (serialization boundary)
- Use `require()` — only `await import('node:...')` for Node built-ins
- Store state in module-level variables (use closure variables or dynamic imports for file I/O)

### auth() → string (token)

The auth function returns a valid access token for the provider's API. It handles token storage, expiry detection, and refresh.

```
Input:  none
Output: string — valid bearer token

Lifecycle:
  1. Read token from disk (~/.silly-code/<provider>-oauth.json)
  2. Check expiry (JWT decode or stored timestamp)
  3. If valid → return token
  4. If expired → refresh using provider's refresh flow
  5. Write refreshed token to disk
  6. Return new token

Error:
  throw Error('<Provider>: no auth token. Run: silly login <provider>')
  — missing token is a user-facing setup error, not a retry scenario
```

### Dependency: adapter calls auth

```
adapter(url, init)
  └── const token = await auth()
      └── reads/refreshes token from disk
  └── converts request using _base helpers
  └── fetches provider endpoint with token
  └── converts response using _base SSE translators
  └── returns Response
```

Token storage is owned by auth. The adapter never reads token files directly.

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

**Upstream upgrade: in the common case, only these constants need updating.** The engine code and provider configs remain unchanged. However, if upstream restructures the code around a match point (not just renames the variable), the engine's patch generation logic for that patch may also need adjustment. This design centralizes fragility into a single file — it does not eliminate it.

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
3. No changes to engine, base, or other providers — when the new provider fits the existing adapter/auth contract and capability model. If it requires a new streaming protocol, auth flow shape, or tool calling convention, `_base.cjs` or engine extensions are also needed.

## Constraints

- Adapter functions remain string-serialized (must run in upstream client factory scope)
- `_base.cjs` functions are serialized alongside adapters (same scope constraint)
- Provider files are regular Node.js modules (not serialized, run at build time only)
- `patch.cjs` orchestrator load order: branding → provider-engine → equality → privacy
- Claude provider's `adapter: null` means zero fetch interception — full native capability

## Build Safeguards

### Layer 1: Provider Config Schema Validation

On build, the engine validates every provider config before generating patches:

- `key` is a non-empty string, unique across all providers
- `runtimeId` is a non-empty string (may duplicate across providers if intentional, e.g. aliasing)
- `envKey` is unique across all providers (or null for exactly one default provider)
- `priority` values do not collide between non-null providers
- `models.default` exists if `models` is provided
- `tierNames` has all three keys: `max`, `pro`, `api`
- `adapter` is a function or null; if non-null, `auth` must also be non-null
- `auth` is a function or null
- `identity.systemPrompt` is a non-empty string
- `contextWindow` is normalized at build time: `null` stays null, `number` → `{ default: number, perModel: {} }`, `object` must have `default` key

Build fails with a descriptive error if validation fails. Provider files are "compile-time verified modules", not convention-based objects.

### Layer 2: Match Assertion

Every patch call asserts exactly 1 match (or the expected count for patchAll). The engine wraps each `patch()` call with a post-check:

```
patch('10-provider-detection', MATCH.DETECT, replacement)
→ if match count !== 1: FAIL with "MATCH.DETECT: expected 1, found N"
```

On build completion, output a patch report:

```
  PATCH REPORT
  ─────────────────────────────────────────
  10-provider-detection    1 match   3 providers in chain
  11-12-provider-adapters  1 match   2 adapters injected (openai, copilot)
  60-model-display         1 match   3 identity branches
  ...
  ─────────────────────────────────────────
  35 OK, 0 FAIL | providers: claude, openai, copilot
```

### Layer 3: Serialization Boundary Enforcement

Adapter functions and `_base.cjs` exports run in a restricted runtime (upstream client factory scope). The engine enforces two checks:

**Static scan:** At build time, scan serialized function source for violations:
- bare `require()` calls → FAIL
- references to `module`, `exports`, `__dirname`, `__filename` → FAIL
- `import()` of non-`node:` packages → FAIL
- Only `await import('node:...')` for Node built-ins is allowed

**Isolation compile check:** After serialization, attempt to compile the combined adapter code string in an isolated `new Function()` context. If it throws a SyntaxError or ReferenceError, build fails with the exact error location. This catches the "builds fine, crashes at runtime" class of bugs that static scanning alone misses.

## Testing

### Smoke Test (build verification)

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

### Protocol Tests (`_base.cjs`)

These are the heaviest test targets — `_base.cjs` is the kernel of the multi-provider architecture:

| Test | What it verifies |
|------|-----------------|
| `msgToOai` — text message | Simple string content passes through |
| `msgToOai` — tool_use block | Produces assistant message with `tool_calls` array |
| `msgToOai` — tool_result block | Produces `role: "tool"` message with correct `tool_call_id` |
| `msgToOai` — mixed content | Text + tool_use in one message → split into correct sequence |
| `makeSseStream` — text delta | OpenAI `choices[0].delta.content` → Anthropic `content_block_delta` |
| `makeSseStream` — tool call | OpenAI `delta.tool_calls` → Anthropic `content_block_start` (tool_use) |
| `makeSseStream` — finish | OpenAI `finish_reason` → Anthropic `message_delta` + `message_stop` |
| `makeResponsesSseStream` — text delta | Responses API `response.output_text.delta` → Anthropic text delta |
| `makeResponsesSseStream` — function call | Responses API `response.output_item.added` → Anthropic tool_use |
| `mapModel` — known mapping | `claude-opus` + openai table → `gpt-5.4` |
| `mapModel` — unknown model | Falls back to `default` entry |

### Behavioral Tests (per-provider)

| Test | What it verifies |
|------|-----------------|
| Tool call round-trip | Model calls a tool, gets result, responds coherently |
| Identity display | TUI header shows correct provider name and model |
| Tier display | Subscription tier shows provider-specific name |
| Context window | Provider respects its configured context limit |
| Auth refresh | Token expiry triggers refresh (OpenAI JWT, Copilot GitHub token) |
| Error propagation | API errors surface as readable messages, not silent hangs |
