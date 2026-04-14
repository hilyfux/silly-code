# CLAUDE.md — silly-code

## What this project is

silly-code is a multi-provider AI coding assistant built on top of the upstream Claude Code binary via a **patch pipeline**. It adds OpenAI Codex and GitHub Copilot as alternative providers while keeping full Claude support.

**This is NOT a source-code fork.** We patch the upstream compiled binary (`cli.js`), not the source.

## Three tracks — every change serves one of these, in sync

silly-code's iteration is a **three-track problem**, not a monolith. Every patch / feature / fix maps to exactly one track, but because they share `_base.cjs` (protocol translation), each change propagates to all three and is verified by a single test sweep (`tests/providers.test.cjs`). That's what "synchronized iteration" means: one edit, three checks, all green or all reverted.

**Track 1 — Claude (firstParty): follow upstream, stay clean**
- Follow @anthropic-ai/claude-code releases (local launchd + CI fallback)
- **Privacy** — zero telemetry, 10 endpoints blocked (patches 30-40)
- **Purity** — no Claude-Code identity bleed through non-firstParty providers (patches 11*, 60-67)
- **Equality** — no tier gating (patches 20-24)

**Track 2 — Codex (OpenAI): best-in-class UX for ChatGPT Pro**
- "Better than Codex CLI" is a product goal, not a side effect
- Proactively fix Responses API + Chat Completions adapter issues (session resume, stop-mid-task, thinking-block leaks, etc. — see `pipeline/patches/providers/_base.cjs` + `openai.cjs`)
- Prompt-level help for GPT's quirks (continuation-discipline, tameSkillPrompts)
- `SILLY_DEBUG_DUMP` + `silly report` feed the optimization loop — dumps → diagnosis → adapter patch

**Track 3 — Copilot: regression-free**
- Not a focus of proactive feature work; `pipeline/patches/providers/copilot.cjs` stays small
- `tests/providers.test.cjs` is the guard — every `_base.cjs` change sweeps Copilot too
- If a Copilot-only regression surfaces in CI and can't be fixed in <30 min, escalate to deprecation

When scoping a change, identify its track **and** verify the other two don't silently break.

## Architecture

```
upstream @anthropic-ai/claude-code (npm pack)
    ↓
pipeline/patch.cjs (orchestrator)
    ├── patches/branding.cjs          (01-07a) URLs, names, mascot color
    ├── patches/provider-engine.cjs   (10-15, 50-51, 60-65) Provider system
    │   └── providers/
    │       ├── _base.cjs             Protocol translation (mapModel, msgToOai, SSE)
    │       ├── claude.cjs            Claude config (default/fallback)
    │       ├── openai.cjs            OpenAI Codex adapter + config
    │       └── copilot.cjs           GitHub Copilot adapter + config
    ├── patches/equality.cjs          (20-21) Tier bypass
    └── patches/privacy.cjs           (30-39) Telemetry blocking
    ↓
pipeline/build/cli-patched.js (output)
```

## Common commands

```bash
# Rebuild patched binary (the main build command)
node pipeline/patch.cjs

# Test providers
CLAUDE_CODE_USE_OPENAI=1 SILLY_CODE_DATA=~/.silly-code node pipeline/build/cli-patched.js -p "hello"
CLAUDE_CODE_USE_COPILOT=1 SILLY_CODE_DATA=~/.silly-code node pipeline/build/cli-patched.js -p "hello"
node pipeline/build/cli-patched.js -p "hello"

# OAuth login
node pipeline/login.mjs codex
node pipeline/login.mjs copilot

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

## Rules

- **Never modify `pipeline/upstream/`** — it's the pristine upstream binary
- **Patch match strings are fragile** — they depend on exact minified code; upstream updates WILL break some
- **Test all 3 providers** after any patch change
- **Adapter functions are string-injected** — they run in the client factory scope, can't access outer variables
- **`src/` is reference only** — runtime uses `pipeline/build/cli-patched.js`, not source code
