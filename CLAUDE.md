# CLAUDE.md — silly-code

## What this project is

silly-code is a multi-provider AI coding assistant built on top of the upstream Claude Code binary via a **patch pipeline**. It adds OpenAI Codex as an alternative provider while keeping full Claude support.

**This is NOT a source-code fork.** We patch the upstream compiled binary (`cli.js`), not the source.

## Two tracks — every change serves one of these, in sync

silly-code's iteration is a **two-track problem**, not a monolith. Every patch / feature / fix maps to exactly one track, but because they share `_base.cjs` (protocol translation), each change propagates to both and is verified by a single test sweep (`tests/providers.test.cjs`). That's what "synchronized iteration" means: one edit, two checks, both green or both reverted.

**Track 1 — Claude (firstParty): follow upstream, stay clean**
- Follow @anthropic-ai/claude-code releases (local launchd + CI fallback)
- **Privacy** — zero telemetry, 10 endpoints blocked (patches 30-40)
- **Purity** — no Claude-Code identity bleed through non-firstParty providers (patches 11*, 60-67)
- **Equality** — no tier gating (patches 20-24); patch 52 clamp is env-opt-in, reads no account state

**Track 2 — Codex (OpenAI): best-in-class UX for ChatGPT Pro**
- "Better than Codex CLI" is a product goal, not a side effect
- Proactively fix Responses API + Chat Completions adapter issues (session resume, stop-mid-task, thinking-block leaks, etc. — see `pipeline/patches/providers/_base.cjs` + `openai.cjs`)
- Prompt-level help for GPT's quirks (continuation-discipline, tameSkillPrompts)
- `SILLY_DEBUG_DUMP` + `silly report` feed the optimization loop — dumps → diagnosis → adapter patch

**Copilot provider is deprecated** and no longer maintained — adapter removed, bypass hook cleared, env flag `CLAUDE_CODE_USE_COPILOT` is a no-op. Do not add Copilot-specific code.

When scoping a change, identify its track **and** verify the other doesn't silently break.

## Architecture

```
upstream @anthropic-ai/claude-code (npm pack)
    ↓
pipeline/patch.cjs (orchestrator)
    ├── match-registry.cjs              MATCH constants + anchor guards (shared)
    ├── patches/
    │   ├── _providers.cjs              Provider loading + validation (shared)
    │   ├── branding.cjs                (01-14b) URLs, names, mascot color
    │   ├── provider-engine.cjs         Wrapper → core → ux → identity
    │   │   ├── provider-core.cjs       (10-15)  Detection, injection, resolution
    │   │   ├── provider-ux.cjs         (50-55)  Context window, menu, heading
    │   │   └── provider-identity.cjs   (60-67)  Display names, identity, tier
    │   ├── equality.cjs                (20-25)  Tier bypass — 技术平权
    │   ├── privacy.cjs                 (30-48)  Telemetry blocking — 隐私安全
    │   ├── auth-bypass.cjs             (70-79)  Non-Claude auth isolation
    │   └── providers/
    │       ├── _base.cjs               Protocol translation (mapModel, msgToOai, SSE)
    │       ├── claude.cjs              Claude config (default/fallback)
    │       └── openai.cjs              OpenAI Codex adapter + config
    ↓
pipeline/build/cli-patched.js (output)
```

## Common commands

```bash
# Rebuild patched binary (the main build command)
node pipeline/patch.cjs

# Test providers
CLAUDE_CODE_USE_OPENAI=1 SILLY_CODE_DATA=~/.silly-code node pipeline/build/cli-patched.js -p "hello"
node pipeline/build/cli-patched.js -p "hello"

# OAuth login
node pipeline/login.mjs codex

# Install (end user)
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
```

## Key directories

- `pipeline/` — Patch pipeline (the core of this project)
- `pipeline/patches/` — Domain-specific patch modules (provider-engine.cjs is the main one)
- `pipeline/patches/providers/` — Per-provider config files + shared base protocol
- `pipeline/upstream/package/` — Upstream binary (gitignored)
- `pipeline/build/` — Patched output (gitignored)
- `bin/` — Launcher scripts (sillyx, sillyt, sillye, silly)
- `skills/` — Project skills (upstream-upgrade workflow)
- `src/` — Legacy v1 source code (reference only, NOT used at runtime)

## Skills

- **`/upstream-upgrade`** — Workflow for upgrading when upstream Claude Code releases a new version. Includes patch failure recovery, variable mapping methodology, and testing protocol. Read `skills/upstream-upgrade.md`.
- **`/sillyx-behavior`** — **Sillyx 必读（OpenAI provider 专用）**。Skill-first 纪律 + PUA 持续推进约束 + upstream upgrade 完整手工路径。任何升级/patch/定时任务排查任务，必须先加载此 skill。

## Rules

- **Never modify `pipeline/upstream/`** — it's the pristine upstream binary
- **Patch match strings are fragile** — they depend on exact minified code; upstream updates WILL break some
- **Test all 3 providers** after any patch change
- **Adapter functions are string-injected** — they run in the client factory scope, can't access outer variables
- **`src/` is reference only** — runtime uses `pipeline/build/cli-patched.js`, not source code

Installed Knowledge Graph: v1.3.1+f6dc89c

Use version+commit to compare source repo, installed copy, and host project state
