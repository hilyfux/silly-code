# silly-code

Multi-provider AI coding assistant. Full Claude Code capabilities, zero telemetry, three provider backends.

```
sillyx    → OpenAI Codex (ChatGPT Pro)
sillyt    → GitHub Copilot
sillye    → Claude (claude.ai)
```

## Quick Start

One command. Installs everything, walks you through login, ready to use.

```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
```

After install, just run:

```bash
sillyt    # Copilot backend
sillyx    # Codex backend
sillye    # Claude backend
```

## Management

```bash
silly status          # Show all provider auth status
silly login <prov>    # Login to a provider (codex/copilot/claude)
silly logout <prov>   # Remove stored tokens
silly models          # List available models per provider
silly doctor          # Check prerequisites
silly uninstall       # Remove silly-code completely
```

## Models & Context Windows

| Provider | Command | Models | Context Window |
|---|---|---|---|
| Codex | `sillyx` | gpt-5.4, gpt-5.4-mini, gpt-5.3-codex | 272k (practical) |
| Copilot | `sillyt` | claude-opus-4-6, claude-sonnet-4, o3 | 128k-200k (Copilot cap) |
| Claude | `sillye` | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 | 200k-1M |

Context windows are auto-detected per provider. The compact threshold adjusts dynamically.

## What This Is

Built on the Claude Code source, combining two community forks:
- **free-code** (paoloanzn) — telemetry removed, 54 feature flags unlocked, Codex adapter
- **cc-haha** (NanmiCoder) — 6 fatal bug fixes, native module stubs, source-run support

### What's different from official Claude Code

- **Zero telemetry** — no OpenTelemetry, GrowthBook, Sentry, or any outbound data
- **No tier discrimination** — all users get Max-level features (1M context, Opus default)
- **Three providers** — Codex, Copilot, Claude via subscription OAuth (no API keys)
- **All features unlocked** — 54 experimental flags, no guardrail injections
- **Runs from source** — `bun` directly, no compile step needed

### What's preserved

Every original Claude Code capability: 40+ tools, MCP, multi-agent, hooks, skills, voice mode, computer use, IDE integration, plan mode, memory system.

## Authentication

All three providers use subscription-based OAuth. No API keys.

| Provider | Auth Flow | Subscription |
|---|---|---|
| Codex | OpenAI OAuth PKCE | ChatGPT Pro |
| Copilot | GitHub Device Flow | GitHub Copilot |
| Claude | claude.ai OAuth PKCE | Claude Pro/Max |

Tokens stored in `~/.silly-code/` with 0600 permissions.

## Requirements

- [Bun](https://bun.sh) >= 1.3.11
- [ripgrep](https://github.com/BurntSushi/ripgrep) (auto-installed by installer)
- macOS or Linux (Windows via WSL)
- At least one subscription: ChatGPT Pro, GitHub Copilot, or Claude Pro/Max

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/uninstall.sh | bash
```

Removes source, global commands, and optionally saved tokens. Also cleans up legacy installs.

## License

MIT
