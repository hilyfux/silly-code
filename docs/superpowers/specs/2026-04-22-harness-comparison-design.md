# Harness Comparison — Codex CLI vs Claude Code, and silly-code's Bridge

Status: **ACTIVE** — basis for 2026-04-22 compatibility sweep
Scope: Analyzed upstream @anthropic-ai/claude-code harness, openai/codex (Rust) harness, and current silly-code bridge layer. Produced prioritized backlog below.

Principles driving every change:
- 极高内聚 / 极低耦合 — each patch touches one vertical, patches are swappable
- 鲁棒性 — every serialized adapter function has a locked evaluator in `tests/compat.test.cjs`
- 隐私安全 — zero telemetry, zero account-state reads, data in `~/.silly-code`
- 技术平权 — no tier gating by account type; `SILLY_CODEX_FAST` is the only opt-in toggle
- 无隐藏暗门 — all behavior surfaces through env vars or patch modules, no silent branches

## 1. The two harnesses side-by-side

| Dimension | Claude Code (upstream binary we patch) | Codex CLI (openai/codex Rust) | silly-code gap today |
|---|---|---|---|
| **Skills** | `~/.claude/skills/`, `.claude/skills/`, plugin namespaces. Description-triggered discovery. `Skill` built-in tool loads content. | `core-skills/` crate. `$mention` explicit + regex `detect_implicit_skill_invocation_for_command`. Each `SKILL.md` + optional `.agents/openai.yaml` sidecar with `policy.products`. | Claude harness gates discovery; `tameSkillPrompts` on GPT strips aggressive directives. No cross-harness skill format. |
| **Hooks** | `PreToolUse/PostToolUse/SessionStart/UserPromptSubmit/PreCompact/Stop` via `settings.json` matcher regex → `additionalContext` injection. | `ClaudeHooksEngine` — **same schema, verbatim**. JSON-schema fixtures at `codex-rs/hooks/src/schema.rs:63-74`. | Hooks fire regardless of provider — the injected `additionalContext` reaches the LLM. Risk: `cleanIdentityForProvider` or `tameSkillPrompts` may strip meaningful context. Needs assertion. |
| **Subagents** | `Agent` tool → `runAgent()` + `createSubagentContext`; `isolation:"worktree"` mode. Fresh context window. | `multi_agents_v2` handlers: `SpawnAgent/SendMessage/WaitAgent/CloseAgent/FollowupTask`. Long-lived threads, not single-shot. | Claude harness subagent inherits provider. Identity cleanup must propagate (so spawned agent doesn't re-hallucinate "I am Claude"). |
| **Tool schema** | `defer_loading` + `ToolSearchTool` loads schemas on demand. MCP tools `mcp__<server>__<tool>`. | BM25-indexed `tool_search` (`core/src/tools/handlers/tool_search.rs`), `COMPUTER_USE_TOOL_SEARCH_LIMIT = 20`. MCP via `rmcp-client`. | Deferred tool format survives serialization (verified in compat tests). Needs assertion for MCP `mcp__server__tool` naming. |
| **Session persistence** | `~/.claude/projects/<hash>/<uuid>.jsonl` single append-only file. `-c` / `/resume` reads it. | JSONL rollouts at `~/.codex/sessions/rollout-<ts>-<uuid>.jsonl` + SQLite at `CODEX_SQLITE_HOME`. `ARCHIVED_SESSIONS_SUBDIR`, `InitialHistory::Resumed`. | Claude single file works for sillyx unchanged. Risk: thinking-block round-trip on resume via Responses API — need assert. |
| **Context / compact** | `/compact` slash, auto-compact threshold, microcompaction, `cache_control` ephemeral. | `core/src/compact.rs`, `CompactionTrigger`, `COMPACT_USER_MESSAGE_MAX_TOKENS=20_000`, `compact_remote.rs`. | Claude `/compact` triggers LLM summarization call. On GPT side it routes through `oaiToAnthropicResponse`, and `cache_control` metadata must be stripped (done in `flattenSystem`). Needs an end-to-end compact sim test. |
| **Reasoning / thinking** | `budgetTokens` + `/think` + `modelSupportsThinking`. | `ReasoningEffort` enum + `ReasoningEffortPreset` + `supports_reasoning_summaries`. Plan mode has its own preset. | sillyx maps Claude high/xhigh → OpenAI priority (sillyFastTier). No effort per-subagent inheritance. Assertable. |
| **Sandbox / safety** | Permission modes + `alwaysAllow/alwaysDeny` regex; classifier auto-approve. Harness-layer. | `seatbelt` (macOS sbpl), `landlock`+`bwrap` (Linux), `windows-sandbox-rs`. Kernel-layer + 5 policies. | silly-code does not touch sandbox — defers to upstream harness. Windows/Linux path assumptions need audit. |
| **Streaming UX** | Spinner + rainbow thinking. | Dedicated `codex-rs/tui/` with chunking docs. | sillyx inherits Claude UX — thinking blocks round-trip via `makeResponsesSseStream` map `response.reasoning_summary_*` → Anthropic `thinking`. Already works. |
| **Config** | Layered `settings.json` + `CLAUDE.md` hierarchy. | TOML + JSON schema + `CODEX_HOME`/`CODEX_SQLITE_HOME`. Per-profile. | silly-code uses Claude's surface for provider-agnostic bits, adds 7 `SILLY_*` env vars. |

## 2. Where Codex design is worth stealing

| Codex feature | Gain for silly-code | Feasibility |
|---|---|---|
| `js_repl` / `code_mode` — one tool to script N others | Reduces tool-call overhead for GPT which is expensive per turn | **Not now** — would require binary-level patch beyond our scope |
| `execpolicy` with `ExecPolicyAmendment` | Adaptive Bash allowlist | **Not now** — out of scope for the harness layer |
| `guardian` — second-model approval review | Extra safety net for risky tool calls | **Not now** — would require wiring a second inference path |
| `agent-identity` / `memories` trace | Explicit identity separate from session | **Partial** — we already do `cleanIdentityForProvider`; memories live in `~/.claude/projects/<hash>/memory/` on Claude harness already |
| Compact prompt template as a file | Easier to diff on upstream bumps | Worth documenting but changing it conflicts with upstream-follow principle |

Decision: **Steal nothing into the binary** — Codex's structural gains are architectural, not API-shape bugs. silly-code's leverage is on the protocol-translation layer, not the harness internals. We will focus instead on hardening translation fidelity.

## 3. Where Claude Code design is worth steering

| Feature Claude exposes | Current sillyx coverage | Work needed |
|---|---|---|
| Skills via description discovery | `tameSkillPrompts` strips aggressive directives but preserves description | Add a compat assertion: preserved skill description survives serialization intact |
| Hooks `additionalContext` | Fires via upstream harness, text reaches LLM | Add compat assertion: cleanIdentityForProvider must not strip `additionalContext` |
| Subagent with spawned Claude-loop | Provider-inherit works; identity must be cleaned | Add compat assertion: when subagent system prompt contains "You are Claude…", cleanIdentityForProvider rewrites it |
| Deferred tool `ToolSearch` | Works on Claude side; GPT may need tool-description cap | Verify MCP `mcp__<server>__<tool>` name format survives `_cleanToolArgs` |
| Session resume with thinking blocks | `makeResponsesSseStream` maps reasoning → thinking | Add compat assertion: thinking blocks round-trip via msgsToResponsesInput without being treated as tool_use |
| `/compact` auto-compaction | LLM summarization call goes through adapter | Add compat assertion: cache_control metadata strip survives system array flattening |
| Per-agent reasoning effort | sillyFastTier reads global effort, not per-subagent | If upstream offers per-agent effort getter, verify it reaches sillyFastTier |

## 4. Cross-platform fault lines

| Platform | silly-code touchpoint | Current state |
|---|---|---|
| **macOS** | Primary dev platform. Launcher uses bash (`sillyx`, `sillyt`, etc.). | Working. |
| **Linux** | Same shell launchers. Auth writes to `~/.silly-code/`. | Working. |
| **Windows** | `silly-launcher.js` spawns `cmd.exe` + ensures `SILLY_CODE_DATA` env. INSTALL object resolves `.ps1` uninstaller path. | `silly-launcher.js` already handles dist vs dev layouts (INSTALL IIFE). Needs a smoke test. |

**Finding:** all three platforms converge on Node.js runtime (the patched `cli-patched.js`). The only OS-specific surface is:
1. bin/ launchers (bash on unix, `.ps1` on Windows)
2. Auth file location (`~/.silly-code/` on all, but `%USERPROFILE%\.silly-code\` on Windows)
3. Process spawn (pinning `SILLY_CODE_DATA` env before spawn — done in bin/silly-launcher.js)

No additional code needed beyond the existing INSTALL object + launchers. Will add a cross-platform path assertion to compat tests.

## 5. Prioritized backlog

**P0 — lock current behavior as regression guards (no code change):**

1. Extend `tests/compat.test.cjs` to lock in the following assertions:
   - `cleanIdentityForProvider` preserves hook-injected `additionalContext` text
   - `cleanIdentityForProvider` rewrites "You are Claude" in subagent system prompts
   - `tameSkillPrompts` preserves `description:` lines from skill frontmatter
   - `msgsToResponsesInput` round-trips thinking blocks through function_call + message pairs
   - `msgToOai` tolerates MCP tool name format `mcp__server__tool`
   - `flattenSystem` strips cache_control from system array
   - Cross-platform: `agentBudgetLog` path uses `path.join` semantics, not naked `/`

2. Add `silly report compat` diagnostic — user can run `silly report compat` to verify the patch-installed binary still passes compat suite.

**P1 — known-gap fixes:**

3. Wire compat.test.cjs into CI (`.github/workflows/ci.yml`) so every push runs the locked evaluator.
4. Audit `cleanIdentityForProvider` to confirm hook `additionalContext` and skill `description` are never stripped; if stripped, narrow the regex.
5. Audit `msgsToResponsesInput` on session-resume case — assistant message with thinking_block + tool_use + tool_result tuple must serialize to: `[reasoning, function_call, function_call_output]` in Responses API schema.

**P2 — cross-platform hardening:**

6. Windows smoke-test path for `bin/silly-launcher.js`: verify `INSTALL` resolves correctly when installed to `%USERPROFILE%\Applications\silly-code\`.
7. Linux smoke-test for `~/.silly-code/` auth file creation when `SILLY_CODE_DATA` unset.

**P3 — observability:**

8. `SILLY_DEBUG_DUMP` auto-tagging — include provider + model + pathway in dump filename for faster triage.
9. `SILLY_AGENT_CORE=1` budget log — confirm ndjson format is the same on Windows (no CRLF issues).

**Out-of-scope (explicitly rejected):**
- Porting Codex `js_repl` / `execpolicy` / `guardian` — architectural, beyond protocol-translation layer.
- Mirroring Codex's TOML config surface — upstream Claude Code uses `settings.json`; following one surface is enough.
- Provider-side skill auto-discovery changes — upstream handles discovery; we only clean what reaches the LLM.

## 6. Implementation phasing

**Phase A (this session):** P0 items — extend compat.test.cjs with 7 new assertions. Run tests, commit.

**Phase B (next session):** P1 items — if any P0 assertion surfaces a gap, fix at `_base.cjs` level, re-run compat, commit.

**Phase C (later):** P2 items — cross-platform smoke-test matrix, likely requires user's Windows machine.

**Phase D (optional):** P3 observability improvements.

## 7. Open questions

- Should `tameSkillPrompts` have a "strict mode" env var for users who actually want aggressive skill directives to reach GPT? Today the rewrite is unconditional. Revisit if anyone asks.
- Is the budget-log ndjson supposed to be a platform-neutral schema? Check `agentBudgetLog` implementation — does it use `os.EOL` or hard `\n`?

## 8. Change log

- 2026-04-22: Created from three parallel research portraits (Codex CLI Rust / Claude Code upstream primitives / silly-code bridge map).
- 2026-04-22: **P0 + partial P1/P2 shipped** in commits `d80c4d1` → `5098807`:
  - `d80c4d1`: compat.test.cjs extended 43→60 assertions; CI wiring; `silly doctor` compat probe.
  - `702b142`: closed 18 Claude-Code identity leaks in tool descriptions forwarded to GPT.
  - `6522ed1`: Chat Completions tool filter aligned with Responses API path (RemoteTrigger filter both).
  - `7fd66bf`: Windows `silly-launcher.js` doctor now probes compat (parity with bash `silly`).
  - `5098807`: Chat Completions `AbortSignal.any([init.signal, timeout])` forwarding (parity with Responses API).

## 9. Status after 2026-04-22 sweep

**Shipped (P0 + P1 partial):**
- ✓ All 7 design-doc invariant assertions present in `tests/compat.test.cjs`.
- ✓ Plus 10 additional assertions (Chinese context preservation, subagent role preservation, skill frontmatter, MCP multi-path naming, cross-platform paths, _cleanToolArgs edge cases, tool-description cleaning).
- ✓ CI gates on compat + build-integrity every push.
- ✓ `silly doctor` (bash + js launcher) surfaces compat count to end users.
- ✓ Privacy leak vectors: 18 tool descriptions + both adapter paths cleaned.
- ✓ Both adapter paths share identical tool filter + abort signal discipline.

**Outstanding:**
- P2.6: Windows smoke-test for INSTALL root walk-up (requires Windows machine).
- P2.7: Linux fresh-install smoke-test for `~/.silly-code/` dir creation.
- P3.8: Include provider + pathway tag in SILLY_DEBUG_DUMP filename.
- P3.9: `silly report` parity on Windows launcher (currently bash-only).

Outstanding items are low-severity convenience improvements; core two-track compat is shipped.
