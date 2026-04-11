# CLAUDE.md — silly-code

## What this project is

silly-code is a multi-provider AI coding assistant built on top of the upstream Claude Code binary via a **patch pipeline**. It adds OpenAI Codex and GitHub Copilot as alternative providers while keeping full Claude support.

**This is NOT a source-code fork.** We patch the upstream compiled binary (`cli.js`), not the source.

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
