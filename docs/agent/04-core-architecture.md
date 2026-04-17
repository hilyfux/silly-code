# silly-code Agent Core Architecture

> 设计草稿 — 2026-04-17 · 未实现 · 讨论基线

Scope: vendor-agnostic agent brain layer owned by silly-code.

---

## 1. North Star

silly-code's agent brain is **provider-agnostic**. The core decisions
— when to compact, what to keep in memory, how much tool output to
budget, how to dispatch sub-agents — are made by silly-code, not by
the upstream vendor.

Provider-specific server optimizations (Anthropic 1h prompt cache,
OpenAI priority tier, reasoning_effort, Anthropic `compact-2026-01-12`
beta) are **bonuses**: the adapter uses them if available, the core
works without them.

### Three red lines

1. **provider-agnostic core** — agent decision functions case only on
   protocol-level signals (token count, turn count, message shape).
   Never on provider name.
2. **graceful degradation** — missing provider optimization never
   breaks the core; worst case is a cost or latency hit.
3. **single subscription sufficient** — a user with only ChatGPT Pro
   OR only Claude Max gets the full agent feature set. Any proposal
   that would force a second subscription is rejected.

---

## 2. Layer map

```
┌─────────────────────────────────────────────┐
│ TUI (upstream patched cli.js)               │ interaction, skills,
│                                             │ slash commands
└──────────────────┬──────────────────────────┘
                   │ fetch(url, init)
┌──────────────────▼──────────────────────────┐
│ silly-code Agent Core                       │ the "brain"
│  ┌─────────────┐ ┌───────────────────────┐  │
│  │ ctx-budget  │ │ compaction            │  │
│  │ tracker     │ │  ├ decider            │  │
│  └─────────────┘ │  └ executor (any LLM) │  │
│                  └───────────────────────┘  │
│  ┌─────────────┐ ┌───────────────────────┐  │
│  │ memory      │ │ tool-output budgeter  │  │
│  │ loader/saver│ └───────────────────────┘  │
│  └─────────────┘ ┌───────────────────────┐  │
│                  │ sub-agent dispatcher  │  │
│                  └───────────────────────┘  │
└──────────────────┬──────────────────────────┘
                   │ normalized Messages protocol
┌──────────────────▼──────────────────────────┐
│ Provider Adapter                            │
│  claude.cjs  (+ cache_control 1h, etc.)     │ existing
│  openai.cjs  (+ service_tier priority, etc) │ existing
│  <future provider>                          │
└─────────────────────────────────────────────┘
```

**Integration point**: the agent core lives at the existing adapter
boundary — the `fetch(url, init)` interceptor in
`pipeline/patches/providers/_base.cjs` + each provider's
`_<key>Adapter` function. Upstream TUI is untouched except where
strictly necessary (status-line signal-out).

---

## 3. Core modules

### M1 · Context Budget Tracker

**Responsibility**: authoritative per-session counter for "how many
tokens is the conversation worth right now" and "how many more fit".

**Inputs**:
- `messages[]` — Anthropic Messages protocol
- `systemPrompt` — string or blocks
- `tools[]` — tool definitions (approximated by JSON byte count)
- `modelContextWindow` — from provider adapter's `contextWindow.perModel`

**Outputs**:
- `{ used, total, remaining, usedPct, compactAt, blockingAt }`

**Algorithm**:
- Primary source: trailing assistant message's `usage` (input_tokens +
  cache_creation + cache_read + output_tokens) — works for all providers.
- Fallback: byte-based estimate (character count ÷ 3.5) when usage
  is missing (already-fixed branch, see `e8dd8e0` / input_tokens=0 bug).
- Reserve: always subtract a **safety margin** (default 20k for
  max_output + 5k for signal overhead).

**Provider-agnostic**: reads `usage` from our normalized shape; the
adapter ensures `usage.input_tokens` is populated regardless of vendor.

**Env flag**: always-on. Disable-only via `SILLY_AGENT_CORE=0` (the
master kill switch).

---

### M2 · Compaction Decider + Executor

**Responsibility**: decide when context is too full, then reduce it by
synthesizing a summary through ANY available model.

#### M2a — Decider

**Inputs**: M1's `{ used, total, compactAt }`, plus turn metadata
(`turnsSinceLastCompact`, `rapidRefillCount`).

**Outputs**: `{ shouldCompact: bool, reason: 'above_threshold' |
'rapid_refill_breaker' | 'blocking_limit' | null }`

**Default policy**:
- Fire when `used >= compactAt` (= total - reserve - headroom).
- Rapid-refill breaker: skip if 3 consecutive turns hit threshold
  within N turns each (Claude Code has this; we adopt its logic
  provider-agnostically).

#### M2b — Executor

**Inputs**: full conversation + compaction prompt + target model.

**Target model resolution** (in priority order):
1. `SILLY_COMPACT_MODEL` env — explicit override
2. Provider adapter's `compactionModel` config (e.g., `claude-haiku-4-5`
   for Claude, `gpt-5.1-codex-mini` for OpenAI)
3. Fallback to the main turn model

**Output**: replacement `messages[]` with earlier turns replaced by
a synthesis block.

**Preservation rules**:
- Keep last N turns verbatim (default: last user message + assistant +
  any in-flight tool_use/result pairs)
- Thinking blocks in the preserved tail are **verbatim** (matches
  Claude Code's existing behavior)
- Compaction summary marked with `<silly-compact-block>` marker so
  future compactions recognize it

**Provider-agnostic**: executor sends a standard Messages request
through the adapter. Adapter may add provider-specific hints
(`x-stainless-helper: compaction` for Anthropic, `reasoning_effort:
low` for OpenAI) but this is optional.

**Env flags**:
- `SILLY_COMPACT=0` — disable entirely, fall back to upstream behavior
- `SILLY_COMPACT_MODEL=<slug>` — explicit compaction model

---

### M3 · Memory Loader / Saver (Rollouts)

**Responsibility**: persist meaningful session state to local disk so
a new session can optionally start with relevant context.

**On session end**:
- If the session produced ≥ M turns of real work (configurable):
  write `~/.silly-code/rollouts/<YYYY-MM-DD>-<session-slug>.md`
  containing: task summary (LLM-generated), key decisions, file
  references, open TODOs.

**On session start** (opt-in):
- Find rollouts for the **same project root** (by cwd match)
- Filter by recency (`SILLY_ROLLOUT_MAX_DAYS`, default 30)
- Budget them against M1 (don't inject more than X% of context)
- Inject as a new system-prompt block with a clear "rollout memory"
  marker

**Privacy**:
- Rollouts are **local-only** — never sent to any remote service
- Auto-scrub API keys, tokens, credentials before write (regex
  allowlist)
- `~/.silly-code/rollouts/` respects `SILLY_NO_ROLLOUT` env — if set,
  rollouts are never written or loaded
- Per-session overrides: `SILLY_ROLLOUT_THIS_SESSION=0` to skip writing

**Provider-agnostic**: rollout synthesis uses M2b (compaction
executor), so the model is whichever user is logged into.

**Env flags**:
- `SILLY_ROLLOUT=1` — opt-in (default off for first rollout of design)
- `SILLY_ROLLOUT_MAX_DAYS=30`
- `SILLY_ROLLOUT_MAX_INJECT_PCT=10`

---

### M4 · Tool Output Budgeter

**Responsibility**: cap individual tool-result byte/token budgets
before they enter the conversation, preventing single large outputs
(e.g., massive `Grep`, `Bash` with huge stdout) from blowing context.

**Intercept point**: wherever tool results are assembled into the
next turn's `messages`. Upstream does this in cli.js; we intercept
via the same adapter boundary by inspecting `messages[].content[].
type === 'tool_result'`.

**Policy**:
- Per-tool soft cap (bytes and tokens both): `MAX_TOOL_BYTES_PER_CALL`
  (default 32k bytes ≈ 8k tokens)
- Total per-turn cap: `MAX_TOOL_BYTES_PER_TURN` (default 128k bytes)
- Truncation mode: keep head + tail, replace middle with
  `[silly-truncated: X bytes / Y tokens; run with
  SILLY_TOOL_NO_CAP=1 to disable]`

**Provider-agnostic**: operates on the normalized tool_result shape.

**Env flags**:
- `SILLY_TOOL_OUTPUT_CAP=1` — enable
- `SILLY_TOOL_NO_CAP=1` — disable per-session

---

### M5 · Sub-Agent Dispatcher

**Responsibility**: when `TaskCreate` spawns a sub-agent, give the
sub-agent a **scoped** context rather than the full parent history.

**Policy**:
- Parent declares which messages are "relevant" for the task (by
  default: the initiating user message + any explicitly referenced
  tool outputs)
- Sub-agent's context = { system prompt, declared-relevant parent
  messages, task description }
- On sub-agent completion, sub-agent emits a structured
  `<silly-subagent-summary>` block that parent ingests as a single
  tool_result

**Depth guard** (borrowed from Codex): max sub-agent recursion depth
(default 3). Beyond that, return `"agent depth limit reached; solve
inline"` to the spawner.

**Provider-agnostic**: uses the standard Messages protocol; different
sub-agents can even run on different providers if the user has
multiple auth (but still: default = same provider as parent, **no**
forced multi-provider).

**Env flag**: `SILLY_SUBAGENT_SCOPE=1` — enable scoped mode (default
off; upstream currently passes fresh-context to sub-agents, this is
a further narrowing).

---

## 4. Provider optimization matrix (bonuses)

The provider adapter layer is free to add these if the provider
supports them. **If the provider doesn't, the agent core still works.**

| Optimization              | Claude | OpenAI | silly-code usage |
|---|---|---|---|
| 1h prompt cache           | ✓ (`cache_control:{ttl:"1h"}`) | ✗ | patch 48 already on |
| Priority tier             | ✗ | ✓ (`service_tier:"priority"`) | patch `bff322e` on when effort high+ |
| Server-side compaction    | ✓ (`compact-2026-01-12` beta) | ✗ | currently off; revisit after M2 |
| Reasoning effort          | ✓ (native) | ✓ (`reasoning_effort`) | Claude upstream handles; OpenAI reads `n8z` → tier |
| Streaming usage chunk     | required | opt-in (`include_usage`) | both on |
| Parallel tool calls       | ✓ | ✓ but flaky | off by default for OpenAI (existing) |
| 1M context window         | ✓ (Opus 4.7 free, others paid) | ✗ (Codex 272k/400k) | patch 52 env-opt-in |

---

## 5. Integration with existing patch pipeline

The agent core does **not** require new upstream patches. It lives
entirely in `pipeline/patches/providers/_base.cjs` + per-provider
adapters. Implementation path:

1. `_base.cjs` grows one new exported namespace: `AgentCore` with
   submodules `budget`, `compact`, `memory`, `toolCap`, `subagent`.
2. Each submodule is **independently toggleable** via env flag.
3. Adapter `_openaiAdapter` / `_claudeAdapter` calls `AgentCore.*`
   helpers at well-defined seams:
   - Before request: `budget.track(messages)` →
     `compact.maybeCompact(messages)` → `toolCap.apply(messages)` →
     `memory.maybeInject(messages, onStart)`
   - After response: `budget.update(usage)` → `rollout.maybeSave(...)`
4. Each module ships in a separate commit with its own tests. Failing
   to ship a module just means that feature is absent; core fetch
   path is unbroken.

---

## 6. Rollout phases

| Phase | Modules | Risk | Test strategy |
|---|---|---|---|
| P0 | M1 budget tracker (pure read, no behavior change) | 0 — observation only | unit test vs upstream `vJ()`, within 5% |
| P1 | M4 tool-output budgeter (opt-in) | LOW | live test: `Bash` large output, verify truncation marker |
| P2 | M2 compaction (opt-in, fallback to upstream) | MED | A/B: silly-code executor vs upstream vI6; compare token counts pre/post |
| P3 | M3 rollout load/save (opt-in) | MED | manual: two-session test, verify project rollout injected; privacy scrub test with fake api keys |
| P4 | M5 sub-agent scope (opt-in) | HIGH | integration test: parent + child via `TaskCreate`; child context ⊂ parent context |

Each phase is behind env. No phase ships as default-on until all
phases green.

---

## 7. Non-goals

- ❌ Building a silly-code-specific TUI (upstream's cli.js stays as UI)
- ❌ Running multiple providers simultaneously (single subscription
  remains the contract — multi-provider user experience is out of
  scope)
- ❌ Server-hosted rollouts / memory (rollouts are local-only, by design)
- ❌ Cross-vendor context transfer (a Claude session's rollout can
  inject into an OpenAI session, but nothing more — no live handoff)
- ❌ Replacing upstream's agent loop entirely (we intercept at the
  fetch boundary, we do not rewrite the event loop)

---

## 8. Open questions

1. **M1 accuracy vs upstream's `vJ()`**: if our tracker disagrees
   with upstream's tracker, which wins for the purpose of the `/context`
   display? Probably upstream (since TUI reads from it), but our
   compaction decision should use our own.
2. **M2 compaction — quality bar**: what's "acceptable" summarization
   quality? Need dumps of real sessions pre/post-compact to judge.
3. **M3 rollout privacy scrubbing**: how aggressive? Regex-based is
   fragile. Consider: whole-file gitignore-style blocklist for
   filenames that match sensitive patterns.
4. **M5 scope declaration**: does the user declare or does silly-code
   auto-select? Leaning auto (by nearest user message + referenced
   tool outputs), with a debug dump to verify in early rollouts.
5. **Interaction with upstream's own compaction**: if M2 fires then
   upstream's `gDY` also fires same turn, we double-compact. Need to
   intercept upstream's gDY via existing patch mechanism to skip when
   SILLY_COMPACT=1.

---

## 9. Explicitly what we do NOT borrow from Codex

- ❌ Codex's `consolidation_model` + `extract_model` dual-model
  persistence pipeline — requires OpenAI-specific plumbing. We do
  single-model compaction per-session through whatever user is on.
- ❌ Codex's thread-DB (SQLite) — too heavy. We use flat `.md` files.
- ❌ Codex's `multi_agent_v2` event bus — too big for first cut. M5
  stays simple: parent waits for child synchronously.
- ❌ Codex's rollout-summary-as-memory-seed — we start simpler: just
  inject last-N rollouts that match cwd, let the model decide relevance.

---

## 10. Next action

When this design is approved:
- Start **P0** (M1 budget tracker, observation-only) in a new
  feature commit.
- Gate all future agent-core code behind `SILLY_AGENT_CORE=1` during
  alpha so users on default build see zero behavior change.
- Update `.claude/skills/upstream-upgrade/SKILL.md` Lane B with the
  architectural scar: "silly-code agent core lives at adapter
  boundary in `_base.cjs`; future upstream renames of `fetch`
  interceptor path are high-risk for P0+".
