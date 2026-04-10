# Silly Code — Architecture & Technical Blueprint

## Vision

Silly Code is not a fork, and it is not just a coding assistant. It is a **full-domain AI assistant** that uses coding as its entry point — the first vertical — but is architecturally designed for any knowledge work: research, writing, data analysis, design, operations, project management.

Claude Code locked itself into "coding assistant." That's their ceiling. It's our floor.

The underlying engine — multi-provider intelligence, 40+ tools, agent orchestration, MCP protocol, plugin system, memory — is domain-agnostic. Code is where developers start. But the same tool system that reads files and runs tests can browse the web, analyze data, manage projects, and automate workflows. The same agent system that spawns code reviewers can spawn researchers, writers, and analysts.

**Strategic equation:** Multi-provider + zero-telemetry + open architecture + domain-agnostic = the general-purpose AI assistant that doesn't exist yet.

## Strategic Differentiation

### Where we already surpass Claude Code

| Dimension | Claude Code | Silly Code | Advantage |
|-----------|:-----------:|:----------:|-----------|
| Scope | Coding only | **Full-domain** (coding as entry point) | Not limited to one vertical |
| Provider support | 1 (Claude) | 3 (Claude + Codex + Copilot) | Users choose the best model for each task |
| Smart routing | None | Task-aware provider selection | Right model for right task |
| Cost visibility | Overall only | Per-provider breakdown | Users see where money goes |
| Telemetry | Full (OTel, Sentry, GrowthBook) | Zero | Privacy-first |
| Feature locks | Tier-gated (Free/Pro/Max) | All unlocked | No artificial limits |
| Auth model | API key or Claude subscription only | Any subscription OAuth | Lower barrier to entry |
| Source access | Compiled binary only | Full source, runs from `bun` | Hackable, extensible |

### Where we need to catch up

| Dimension | Gap | Path to close |
|-----------|-----|---------------|
| Version freshness | 2.1.87 vs 2.1.98 | Upstream merge workflow |
| Missing modules | 43 flags still off | Implement or stub remaining |
| Compiled binary | No compiled dist yet | `bun run compile` pipeline |
| Auto-update | No update mechanism | Self-update via install.sh |

### Where we will surpass (roadmap)

| Capability | Claude Code doesn't have it | Our approach |
|------------|:-------------------------:|--------------|
| Full-domain assistant | Coding only | Domain-agnostic engine, vertical skill packs |
| Provider routing | None | Smart routing: pick best model per task |
| Offline mode | - | Local model fallback (Ollama/llama.cpp) |
| Cost optimization | - | Track spend per provider, suggest cheaper alternatives |
| Community plugins | - | Open plugin marketplace |
| Multi-model chains | - | Use Claude for reasoning, GPT for code, Copilot for completion |
| Domain skill packs | - | Research, writing, data analysis, design skill bundles |
| Session sharing | - | Export/import sessions across machines |
| Team mode | - | Shared context across team members |
| Workflow automation | - | User-defined workflows for any domain task |

## System Architecture

### Layer 1: Provider Plane

```
┌─────────────────────────────────────────────┐
│                Provider Plane                │
├─────────┬──────────┬──────────┬─────────────┤
│ Claude  │  Codex   │ Copilot  │  Local LLM  │
│ (1P)    │ (OpenAI) │ (GitHub) │  (future)   │
├─────────┴──────────┴──────────┴─────────────┤
│           Provider Registry                  │
│  - ProviderId / Descriptor / Capabilities    │
│  - Auth lifecycle (OAuth PKCE / Device Flow) │
│  - Token store (~/.silly-code/)              │
│  - Fetch adapter factory                     │
│  - Model mapping (canonical → provider)      │
│  - Smart routing (future)                    │
└─────────────────────────────────────────────┘
```

Already implemented: `src/services/provider/registry.ts`, `types.ts`, `index.ts`

Next steps:
- ProviderCapabilities interface (context window, tool support, streaming)
- Smart router: select provider based on task type, cost, latency
- Provider health monitoring and automatic failover
- Local LLM adapter (Ollama protocol)

### Layer 2: Intelligence Plane

```
┌─────────────────────────────────────────────┐
│             Intelligence Plane               │
├─────────────────────────────────────────────┤
│  QueryEngine                                │
│  ├── System prompt assembly                 │
│  ├── Context window management              │
│  ├── Tool dispatch                          │
│  ├── Multi-turn conversation                │
│  └── Provider-neutral API contract          │
├─────────────────────────────────────────────┤
│  Tool Registry                              │
│  ├── 40+ built-in tools                     │
│  ├── MCP server tools                       │
│  ├── Plugin-provided tools                  │
│  └── Tool permission engine                 │
├─────────────────────────────────────────────┤
│  Agent System                               │
│  ├── Sub-agent spawning                     │
│  ├── Worktree isolation                     │
│  ├── Background sessions                    │
│  └── Multi-agent coordination (future)      │
├─────────────────────────────────────────────┤
│  Skill System                               │
│  ├── Bundled skills                         │
│  ├── Plugin skills                          │
│  ├── Dynamic skill discovery                │
│  └── Skill search (future: semantic)        │
└─────────────────────────────────────────────┘
```

### Layer 3: Command Plane

```
┌─────────────────────────────────────────────┐
│              Command Plane                   │
├─────────────────────────────────────────────┤
│  Command Registry                           │
│  ├── registry/builtin.ts (core commands)    │
│  ├── registry/external.ts (plugins/skills)  │
│  ├── registry/availability.ts (auth filter) │
│  └── commands.ts (orchestrator)             │
├─────────────────────────────────────────────┤
│  Slash Commands                             │
│  ├── /login /logout /status                 │
│  ├── /model /compact /plan                  │
│  ├── /fork /proactive /ultraplan            │
│  ├── /workflow (user-defined)               │
│  └── Plugin-provided commands               │
├─────────────────────────────────────────────┤
│  CLI Subcommands                            │
│  ├── silly status/login/logout/models       │
│  ├── silly doctor/uninstall                 │
│  ├── silly auto-mode defaults/config        │
│  ├── silly ps/logs/kill (bg sessions)       │
│  └── silly daemon start/stop/status         │
└─────────────────────────────────────────────┘
```

### Layer 4: Runtime Plane

```
┌─────────────────────────────────────────────┐
│              Runtime Plane                   │
├─────────────────────────────────────────────┤
│  CLI Bootstrap (cli.tsx)                    │
│  ├── Fast-path routing                      │
│  ├── Config/auth initialization             │
│  ├── Feature flag dispatch                  │
│  └── Permission mode selection              │
├─────────────────────────────────────────────┤
│  REPL (screens/REPL.tsx)                    │
│  ├── Ink/React terminal UI                  │
│  ├── Input handling                         │
│  ├── Message rendering                      │
│  ├── Status line                            │
│  └── Theme system                           │
├─────────────────────────────────────────────┤
│  State Management                           │
│  ├── App state store                        │
│  ├── Session persistence                    │
│  ├── Memory system                          │
│  ├── Hooks (React + lifecycle)              │
│  └── Background tasks                       │
├─────────────────────────────────────────────┤
│  Distribution                               │
│  ├── Source mode (bun ./src/...)            │
│  ├── Dev build (bun run build:dev)          │
│  ├── Compiled binary (bun run compile)      │
│  ├── One-line installer (install.sh)        │
│  └── Auto-update (future)                   │
└─────────────────────────────────────────────┘
```

### Layer 5: Extension Plane

```
┌─────────────────────────────────────────────┐
│             Extension Plane                  │
├─────────────────────────────────────────────┤
│  Plugin System                              │
│  ├── Plugin discovery & loading             │
│  ├── Plugin marketplace integration         │
│  ├── Plugin sandboxing                      │
│  └── Plugin API surface                     │
├─────────────────────────────────────────────┤
│  MCP Integration                            │
│  ├── MCP server management                  │
│  ├── MCP tool bridging                      │
│  ├── MCP skill integration                  │
│  └── Rich output rendering                  │
├─────────────────────────────────────────────┤
│  IDE Bridge                                 │
│  ├── VS Code extension                      │
│  ├── JetBrains plugin                       │
│  ├── Remote control                         │
│  └── LSP integration                        │
├─────────────────────────────────────────────┤
│  Voice & Computer Use                       │
│  ├── Voice input/output                     │
│  ├── Computer use (Python bridge)           │
│  └── Chrome integration                     │
└─────────────────────────────────────────────┘
```

## Data Flow

### Request lifecycle

```
User input
    │
    ▼
CLI Bootstrap → fast-path check → subcommand dispatch
    │                                    │
    │ (interactive)                      │ (non-interactive: -p/--print)
    ▼                                    ▼
REPL.tsx                            print handler
    │                                    │
    ├── slash command? ──→ Command Registry ──→ execute
    │                                    │
    ▼                                    │
QueryEngine ◄────────────────────────────┘
    │
    ├── assemble system prompt
    ├── select provider (smart routing)
    ├── construct API client (provider adapter)
    ├── stream response
    │
    ├── tool call? ──→ Tool Registry ──→ permission check ──→ execute
    │                      │
    │                      ├── spawn sub-agent?
    │                      ├── MCP tool?
    │                      └── built-in tool
    │
    ├── continue conversation
    │
    └── render response ──→ terminal UI
```

### Provider selection (future smart routing)

```
Task arrives
    │
    ▼
Classify task type:
    ├── Reasoning-heavy → prefer Claude Opus
    ├── Code generation → prefer GPT-5.4 / Claude Sonnet
    ├── Fast completion → prefer Haiku / GPT-5.4-mini
    ├── Cost-sensitive → prefer cheapest available
    └── User override → use specified model
    │
    ▼
Check provider health:
    ├── Rate limited? → failover to next provider
    ├── Down? → failover
    └── Healthy → proceed
    │
    ▼
Construct provider-specific client
    │
    ▼
Execute with timeout + retry
```

## Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Bun 1.3+ | Fast startup, TypeScript native, embedded features |
| UI | Ink + React | Terminal UI with component model |
| Build | Bun bundler | Single-file compilation, feature flags via DCE |
| Package | TypeScript strict | Type safety across codebase |
| Auth | OAuth PKCE / Device Flow | No API keys needed |
| IPC | Unix domain sockets | Sub-agent communication |
| Search | ripgrep | Fast file search (system binary) |
| State | JSON files | Simple, no database dependency |
| Tests | bun:test | Zero-config, fast, built-in |

## Feature Flag Architecture

88 total flags in codebase. Current status:

| Category | Enabled | Available but off | Missing source |
|----------|:-------:|:-----------------:|:--------------:|
| Core UI/UX | 14 | 0 | 0 |
| Agent/Memory | 5 | 0 | 0 |
| Build intelligence | 10 | 0 | 0 |
| Remote/Bridge | 4 | 0 | 0 |
| Auto mode | 1 | 0 | 0 |
| New implementations | 8 | 0 | 0 |
| MCP | 1 | 2 | 0 |
| Remaining | 0 | 0 | 43 |
| **Total** | **45** | **2** | **43** |

The 43 missing-source flags are mostly Anthropic-internal (KAIROS full stack, @ant/ packages, internal tooling). We will selectively implement those that add user value.

## Security Model

| Boundary | Protection |
|----------|-----------|
| Auth tokens | ~/.silly-code/ with 0600 permissions |
| Provider keys | Never stored as plaintext API keys; OAuth tokens only |
| Tool execution | Permission engine (bypassPermissions / default / plan) |
| File access | Sandbox-aware, configurable allow/deny patterns |
| Network | No outbound telemetry; only provider API calls |
| Plugins | Plugin sandbox (future: capability-based) |
| Install | User-local only (~/.local/), no sudo |

## Quality Standards

| Area | Standard |
|------|----------|
| Boot time | < 2 seconds from `sillyt` to interactive prompt |
| Test coverage | Focused contract tests on architectural seams |
| Error messages | Provider-aware, actionable, no raw stack traces |
| Uninstall | One command, leaves no orphaned files |
| Update | One command, preserves auth and settings |

## Development Workflow

```
Feature idea
    │
    ▼
Architecture spec (docs/superpowers/specs/)
    │
    ▼
Implementation plan (docs/superpowers/plans/)
    │
    ▼
Worktree branch
    │
    ▼
TDD: failing test → implement → verify
    │
    ▼
Code review (self + automated)
    │
    ▼
Merge to main → push
```

## Roadmap

### Phase 1: Foundation (current — mostly done)
- [x] Multi-provider architecture
- [x] Provider registry and contracts
- [x] Command registry convergence
- [x] 45 feature flags enabled
- [x] 13 missing modules implemented
- [x] One-command install/uninstall
- [x] Auto-login on first run
- [x] ripgrep auto-install
- [x] Full audit and bug fixes
- [ ] Upstream merge to 2.1.98

### Phase 2: Intelligence (next)
- [ ] Smart provider routing
- [ ] Cost tracking per session/provider
- [ ] Provider failover and health monitoring
- [ ] Context window optimization per provider
- [ ] Multi-model chains (reasoning + code + review)

### Phase 3: Community
- [ ] Open plugin marketplace
- [ ] Community skill sharing
- [ ] Session export/import
- [ ] Team shared context
- [ ] Contribution guide

### Phase 4: Autonomy
- [ ] Local LLM support (Ollama adapter)
- [ ] Offline-capable mode
- [ ] Self-hosted runner
- [ ] Background agent (daemon mode with real workers)
- [ ] Proactive code analysis

### Phase 5: Computer Use — the real differentiator
- [ ] Screen capture + OCR (understand what's on screen)
- [ ] Mouse/keyboard automation (click, type, scroll, drag)
- [ ] Browser automation (navigate, fill forms, extract data)
- [ ] App control (launch, switch, interact with native apps)
- [ ] File manager operations (drag-drop, organize, batch rename)
- [ ] System automation (settings, preferences, notifications)
- [ ] Multi-step task chains (e.g. "download CSV from email, open in Excel, make chart, paste into Slides")
- [ ] Self-correcting loops (take action → screenshot → verify → retry if wrong)

### Phase 6: Platform
- [ ] Web UI (claude.ai/code equivalent)
- [ ] Mobile companion
- [ ] CI/CD integration
- [ ] Enterprise features (SSO, audit log)
- [ ] Marketplace for community skill packs

## Success Metrics

| Metric | Target |
|--------|--------|
| Install-to-first-use | < 60 seconds |
| Provider switch time | < 1 second |
| Feature parity with Claude Code | > 90% |
| Unique capabilities Claude Code lacks | >= 5 |
| Active community plugins | >= 10 |
| Zero telemetry | Always |
