# silly-code

[English](#english) | [中文](#中文) | [日本語](#日本語) | [Français](#français)

---

<a id="english"></a>

## English

Multi-provider AI assistant built on the latest Claude Code 2.1.104 via patch pipeline. Three pillars: **privacy** (zero telemetry), **purity** (no upstream residue), **equality** (all features unlocked for every user).

```
sillyx    → OpenAI Codex (ChatGPT Pro)
sillyt    → GitHub Copilot
sillye    → Claude (claude.ai)

sillyxs / sillyts / sillyes   → same providers, --dangerously-skip-permissions
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
| Telemetry | 10+ endpoints | All blocked |
| Feature locks | Tier-gated | Max tier + `/loop` unlocked |
| Identity leaks | Brand baked in | Scrubbed from LLM prompts |
| Source | Compiled binary | 78 patches, fully inspectable |

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

基于最新 Claude Code 2.1.104，通过补丁流水线构建的多供应商 AI 助手。三大基石：**隐私保护**（零遥测）、**纯净优化**（清除上游残留）、**技术平权**（所有功能对所有用户开放）。

```
sillyx    → OpenAI Codex（ChatGPT Pro）
sillyt    → GitHub Copilot
sillye    → Claude（claude.ai）

sillyxs / sillyts / sillyes   → 对应 provider，默认跳过权限确认（--dangerously-skip-permissions）
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
| 遥测 | 10+ 端点 | 全部封堵 |
| 功能限制 | 按等级限制 | Max 等级 + `/loop` 全解锁 |
| 身份泄漏 | 品牌烙印 | 从 LLM 提示词中清除 |
| 源码 | 编译二进制 | 78 个补丁，完全可审查 |

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

最新の Claude Code 2.1.104 をパッチパイプラインで再構築したマルチプロバイダー AI アシスタント。3つの柱：**プライバシー保護**（ゼロテレメトリ）、**純粋化**（上流の痕跡を除去）、**技術の平等**（すべての機能をすべてのユーザーに開放）。

```
sillyx    → OpenAI Codex（ChatGPT Pro）
sillyt    → GitHub Copilot
sillye    → Claude（claude.ai）

sillyxs / sillyts / sillyes   → 同じプロバイダー、権限確認をスキップ（--dangerously-skip-permissions）
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
| テレメトリ | 10+ エンドポイント | すべて遮断 |
| 機能制限 | ティア別制限 | Max ティア + `/loop` 解放 |
| アイデンティティ漏洩 | ブランドが焼き込み | LLM プロンプトから除去 |
| ソース | コンパイル済みバイナリ | 78 パッチ、完全検査可能 |

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

Assistant IA multi-fournisseur construit sur la dernière version de Claude Code 2.1.104 via un pipeline de patchs. Trois piliers : **protection de la vie privée** (zéro télémétrie), **pureté** (aucun résidu amont), **égalité technologique** (toutes les fonctionnalités débloquées pour chaque utilisateur).

```
sillyx    → OpenAI Codex (ChatGPT Pro)
sillyt    → GitHub Copilot
sillye    → Claude (claude.ai)

sillyxs / sillyts / sillyes   → mêmes fournisseurs, --dangerously-skip-permissions
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
| Télémétrie | 10+ endpoints | Tous bloqués |
| Verrouillage | Par niveau | Max + `/loop` déverrouillés |
| Fuites d'identité | Marque incrustée | Retirées des prompts LLM |
| Source | Binaire compilé | 78 patchs, entièrement vérifiable |

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
