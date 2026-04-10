# silly-code

[English](#english) | [中文](#中文) | [日本語](#日本語) | [Français](#français)

---

<a id="english"></a>

## English

Multi-provider AI assistant. Coding is the entry point — not the ceiling. Zero telemetry, three provider backends, smart routing, auto-failover.

```
sillyx    → OpenAI Codex (ChatGPT Pro)
sillyt    → GitHub Copilot
sillye    → Claude (claude.ai)
```

### Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
silly doctor
sillyt    # or sillyx / sillye
```

### What's Different from Claude Code

| | Claude Code | Silly Code |
|---|---|---|
| Providers | Claude only | Claude + Codex + Copilot |
| Telemetry | Full | Zero |
| Feature locks | Tier-gated | All unlocked |
| Source | Compiled binary | Patched, fully inspectable |

### Management

```bash
silly status          # Provider auth status
silly login <prov>    # Login (codex/copilot/claude)
silly logout <prov>   # Remove tokens
silly doctor          # Full diagnostic
silly uninstall       # Remove completely
```

### Requirements

- macOS or Linux (Windows via WSL)
- At least one subscription: ChatGPT Pro, GitHub Copilot, or Claude Pro/Max
- [Bun](https://bun.sh) >= 1.3.11 and [ripgrep](https://github.com/BurntSushi/ripgrep) — both auto-installed

### Uninstall

```bash
silly uninstall
```

---

<a id="中文"></a>

## 中文

多供应商 AI 助手。编码是起点，不是天花板。零遥测，三个供应商后端，智能路由，自动故障转移。

```
sillyx    → OpenAI Codex（ChatGPT Pro）
sillyt    → GitHub Copilot
sillye    → Claude（claude.ai）
```

### 快速开始

```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
silly doctor
sillyt    # 或 sillyx / sillye
```

### 与 Claude Code 的区别

| | Claude Code | Silly Code |
|---|---|---|
| 供应商 | 仅 Claude | Claude + Codex + Copilot |
| 遥测 | 完整采集 | 零遥测 |
| 功能限制 | 按等级限制 | 全部解锁 |
| 源码 | 编译二进制 | 补丁注入，完全可审查 |

### 管理命令

```bash
silly status          # 查看供应商认证状态
silly login <prov>    # 登录（codex/copilot/claude）
silly logout <prov>   # 删除认证令牌
silly doctor          # 完整系统诊断
silly uninstall       # 完全卸载
```

### 环境要求

- macOS 或 Linux（Windows 通过 WSL）
- 至少一个订阅：ChatGPT Pro、GitHub Copilot 或 Claude Pro/Max
- [Bun](https://bun.sh) >= 1.3.11 和 [ripgrep](https://github.com/BurntSushi/ripgrep)（安装时自动安装）

---

<a id="日本語"></a>

## 日本語

マルチプロバイダーAIアシスタント。コーディングは出発点であり、上限ではありません。ゼロテレメトリ、3つのプロバイダーバックエンド、スマートルーティング、自動フェイルオーバー。

```
sillyx    → OpenAI Codex（ChatGPT Pro）
sillyt    → GitHub Copilot
sillye    → Claude（claude.ai）
```

### クイックスタート

```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
silly doctor
sillyt    # または sillyx / sillye
```

### Claude Code との違い

| | Claude Code | Silly Code |
|---|---|---|
| プロバイダー | Claude のみ | Claude + Codex + Copilot |
| テレメトリ | 完全収集 | ゼロ |
| 機能制限 | ティア別制限 | 全機能解放 |
| ソース | コンパイル済みバイナリ | パッチ注入、完全検査可能 |

### 管理コマンド

```bash
silly status          # プロバイダー認証状態
silly login <prov>    # ログイン（codex/copilot/claude）
silly logout <prov>   # トークン削除
silly doctor          # 完全診断
silly uninstall       # 完全アンインストール
```

### 動作要件

- macOS または Linux（Windows は WSL 経由）
- 少なくとも1つのサブスクリプション：ChatGPT Pro、GitHub Copilot、または Claude Pro/Max
- [Bun](https://bun.sh) >= 1.3.11 と [ripgrep](https://github.com/BurntSushi/ripgrep)（自動インストール）

---

<a id="français"></a>

## Français

Assistant IA multi-fournisseur. Le code est le point d'entrée — pas le plafond. Zéro télémétrie, trois backends, routage intelligent, basculement automatique.

```
sillyx    → OpenAI Codex (ChatGPT Pro)
sillyt    → GitHub Copilot
sillye    → Claude (claude.ai)
```

### Démarrage rapide

```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
silly doctor
sillyt    # ou sillyx / sillye
```

### Différences avec Claude Code

| | Claude Code | Silly Code |
|---|---|---|
| Fournisseurs | Claude uniquement | Claude + Codex + Copilot |
| Télémétrie | Complète | Zéro |
| Verrouillage | Par niveau | Tout déverrouillé |
| Source | Binaire compilé | Patchs injectés, entièrement vérifiable |

### Commandes de gestion

```bash
silly status          # État d'authentification des fournisseurs
silly login <prov>    # Connexion (codex/copilot/claude)
silly logout <prov>   # Supprimer les jetons
silly doctor          # Diagnostic complet
silly uninstall       # Désinstallation complète
```

### Prérequis

- macOS ou Linux (Windows via WSL)
- Au moins un abonnement : ChatGPT Pro, GitHub Copilot ou Claude Pro/Max
- [Bun](https://bun.sh) >= 1.3.11 et [ripgrep](https://github.com/BurntSushi/ripgrep) (auto-installés)

---

## License

MIT
