# Dogfooding Guide — v0.1.0-rc1

## Quick Start

```bash
# Install from RC tag (frozen, won't drift)
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/v0.1.0-rc1/install.sh | bash

# Or if already installed, pin to this commit:
cd ~/.local/share/silly-code && git fetch && git checkout v0.1.0-rc1

# Start
sillyt    # Copilot
sillyx    # Codex
sillye    # Claude
```

## Self-Check

```bash
silly doctor    # Run before first use — checks everything
silly status    # Show provider auth status
```

## What's On by Default

- Multi-provider conversation (Claude / Codex / Copilot)
- 27 stable feature flags (UI, memory, code intelligence)
- Conservative cross-provider fallback (on 529 overload)
- AutoDream memory consolidation (24h + 5 sessions gate)
- Memory auto-extraction after each query
- bypassPermissions mode (no tool confirmation prompts)
- /route /cost /status observability

## What's Off by Default

Enable experimental features:
```bash
export SILLY_EXPERIMENTAL=1
sillyt  # Now includes KAIROS, coordinator, proactive, daemon, etc.
```

Computer use (macOS only):
```bash
sillyt --computer-use-mcp
```

## Known Limitations

- Cross-provider fallback maps to target provider's default model (not exact equivalents)
- Computer use requires macOS + Accessibility + Screen Recording permissions
- AutoDream has not been tested at scale — watch ~/.claude/projects/*/memory/
- Some test imports fail due to auth.ts missing export (runtime unaffected)
- Provider health data is session-only (resets on restart)

## When Something Goes Wrong

```bash
# 1. Check system health
silly doctor

# 2. Check provider status
# Inside a session:
/route

# 3. Check costs
/cost

# 4. Check debug reports (auto-captured on failures)
ls ~/.silly-code/debug-reports/
cat ~/.silly-code/debug-reports/report-*.json | tail -1 | python3 -m json.tool

# 5. Check memory state
ls ~/.claude/projects/*/memory/
```

## This Week: What to Watch

1. **Stability**: Does the basic conversation loop work without crashes?
2. **Provider**: Does /route show accurate health after errors?
3. **Memory**: Are AutoDream writes sensible or noisy?
4. **Cost**: Does /cost match your expected usage?
5. **Fallback**: If you hit 429, does the agent recover?

## Reporting Issues

When filing a bug, include:
- Output of `silly doctor`
- Last debug report: `cat ~/.silly-code/debug-reports/report-*.json | tail -1`
- Steps to reproduce
- Expected vs actual behavior
