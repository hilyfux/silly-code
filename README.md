# silly-code

Multi-provider AI coding assistant built on [Claude Code](https://github.com/anthropics/claude-code) — adds OpenAI Codex (ChatGPT Pro) support alongside the upstream Claude provider.

Patches the upstream binary at install time. No fork, no tarballs, no telemetry.

## Install

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
```

**Windows (PowerShell)**
```powershell
irm "https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1?$(Get-Date -f yyyyMMddHHmm)" | iex
```

The installer clones this repo to `~/.local/share/silly-code`, runs `pipeline/patch.cjs` locally, and drops launcher wrappers into `~/.local/bin`. Uninstall removes both directories — no system-level files.

## Commands

| Command | Provider | Requirement |
|---------|----------|-------------|
| `sillyx` | OpenAI Codex | ChatGPT Pro |
| `sillye` | Claude       | Claude Pro / Max |
| `silly`  | Management CLI (`login`, `update`, `doctor`, `uninstall`) | — |

## Project layout

- `installer/` — `install.{sh,ps1}` + `uninstall.{sh,ps1}` (mirrored to repo root by CI so the install URL stays stable)
- `pipeline/` — patch build pipeline + provider adapters
- `bin/` — runtime launchers
- `tests/` — invariant + parity tests (`npm test`)

See [`CLAUDE.md`](CLAUDE.md) for architecture detail.

## Development

```bash
node pipeline/patch.cjs   # rebuild patched binary
npm test                  # full test suite (16 scripts)
```

Push to `main` triggers `.github/workflows/sync-installer.yml`, which copies `installer/install.{sh,ps1}` and `installer/uninstall.{sh,ps1}` to the repo root so `raw.githubusercontent.com/.../main/install.sh` keeps resolving to current source.

## Requirements

- Node.js ≥ 20
- Git
- macOS / Linux / Windows
