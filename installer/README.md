# silly-code

Multi-provider AI coding assistant built on Claude Code — adds OpenAI Codex (ChatGPT Pro) support.

## Install

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
```

**Windows (PowerShell)**
```powershell
irm "https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1?$(Get-Date -f yyyyMMddHHmm)" | iex
```

## Providers

| Command | Provider | Requirement |
|---------|----------|-------------|
| `sillyx` | OpenAI Codex | ChatGPT Pro subscription |
| `sillye` | Claude | Claude Pro / Max subscription |

## Usage

```bash
silly login codex    # Login to ChatGPT Pro
silly login claude   # Login to Claude
sillyx               # Start with Codex
sillye               # Start with Claude
silly update         # Update to latest release
silly uninstall      # Remove silly-code
```

## Requirements

- Node.js >= 20
- macOS / Linux / Windows
