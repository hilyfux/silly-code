# silly-code

[English](#english) | [中文](#中文) | [日本語](#日本語) | [Français](#français)

---

<a id="english"></a>

## English

Multi-provider AI assistant built on the latest Claude Code 2.1.110 via patch pipeline. Three pillars: **privacy** (zero telemetry), **purity** (no upstream residue), **equality** (all features unlocked for every user).

```
sillyx    → OpenAI Codex (ChatGPT Pro)
sillye    → Claude (claude.ai)

sillyxs / sillyes   → same providers, --dangerously-skip-permissions
```

### Quick Start

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
silly doctor
sillyx    # or sillye
```

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1 | iex
silly doctor
sillyx    # or sillye
```

If you installed an earlier Windows build, run the installer again to refresh the `.cmd` launchers.

### What's Different from Claude Code

| | Claude Code | Silly Code |
|---|---|---|
| Providers | Claude only | Claude + Codex |
| Telemetry | 10+ endpoints | All blocked |
| Feature locks | Tier-gated | Max tier + `/loop` unlocked |
| Identity leaks | Brand baked in | Scrubbed from LLM prompts |
| Source | Compiled binary | 102 patches, fully inspectable |

### Management

```bash
silly status          # Provider auth status
silly login <prov>    # Login (codex/claude)
silly logout <prov>   # Remove tokens
silly doctor          # Full diagnostic
silly uninstall       # Remove completely
```

### Requirements

- macOS, Linux, or Windows PowerShell 7+
- At least one subscription: ChatGPT Pro or Claude Pro/Max
- [Node.js](https://nodejs.org/) >= 20 and Git
- [ripgrep](https://github.com/BurntSushi/ripgrep) is auto-installed when missing on supported platforms

### Uninstall

```bash
silly uninstall
```

---

<a id="中文"></a>

## 中文

基于最新 Claude Code 2.1.110，通过补丁流水线构建的多供应商 AI 助手。三大基石：**隐私保护**（零遥测）、**纯净优化**（清除上游残留）、**技术平权**（所有功能对所有用户开放）。

```
sillyx    → OpenAI Codex（ChatGPT Pro）
sillye    → Claude（claude.ai）

sillyxs / sillyes   → 对应 provider，默认跳过权限确认（--dangerously-skip-permissions）
```

### 快速开始

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
silly doctor
sillyx    # 或 sillye
```

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1 | iex
silly doctor
sillyx    # 或 sillye
```

如果你安装的是更早的 Windows 版本，请重新执行一次安装脚本以刷新 `.cmd` 启动器。

### 与 Claude Code 的区别

| | Claude Code | Silly Code |
|---|---|---|
| 供应商 | 仅 Claude | Claude + Codex |
| 遥测 | 10+ 端点 | 全部封堵 |
| 功能限制 | 按等级限制 | Max 等级 + `/loop` 全解锁 |
| 身份泄漏 | 品牌烙印 | 从 LLM 提示词中清除 |
| 源码 | 编译二进制 | 102 个补丁，完全可审查 |

### 管理命令

```bash
silly status          # 查看供应商认证状态
silly login <prov>    # 登录（codex/claude）
silly logout <prov>   # 删除认证令牌
silly doctor          # 完整系统诊断
silly uninstall       # 完全卸载
```

### 环境要求

- macOS、Linux，或 Windows PowerShell 7+
- 至少一个订阅：ChatGPT Pro 或 Claude Pro/Max
- [Node.js](https://nodejs.org/) >= 20 和 Git
- [ripgrep](https://github.com/BurntSushi/ripgrep) 在受支持平台缺失时会自动安装

---

<a id="日本語"></a>

## 日本語

最新の Claude Code 2.1.110 をパッチパイプラインで再構築したマルチプロバイダー AI アシスタント。3つの柱：**プライバシー保護**（ゼロテレメトリ）、**純粋化**（上流の痕跡を除去）、**技術の平等**（すべての機能をすべてのユーザーに開放）。

```
sillyx    → OpenAI Codex（ChatGPT Pro）
sillye    → Claude（claude.ai）

sillyxs / sillyes   → 同じプロバイダー、権限確認をスキップ（--dangerously-skip-permissions）
```

### クイックスタート

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
silly doctor
sillyx    # または sillye
```

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1 | iex
silly doctor
sillyx    # または sillye
```

### Claude Code との違い

| | Claude Code | Silly Code |
|---|---|---|
| プロバイダー | Claude のみ | Claude + Codex |
| テレメトリ | 10+ エンドポイント | すべて遮断 |
| 機能制限 | ティア別制限 | Max ティア + `/loop` 解放 |
| アイデンティティ漏洩 | ブランドが焼き込み | LLM プロンプトから除去 |
| ソース | コンパイル済みバイナリ | 102 パッチ、完全検査可能 |

### 管理コマンド

```bash
silly status          # プロバイダー認証状態
silly login <prov>    # ログイン（codex/claude）
silly logout <prov>   # トークン削除
silly doctor          # 完全診断
silly uninstall       # 完全アンインストール
```

### 動作要件

- macOS、Linux、または Windows PowerShell 7+
- 少なくとも1つのサブスクリプション：ChatGPT Pro、または Claude Pro/Max
- [Node.js](https://nodejs.org/) >= 20 と Git
- [ripgrep](https://github.com/BurntSushi/ripgrep) は対応プラットフォームで未導入時に自動インストール

---

<a id="français"></a>

## Français

Assistant IA multi-fournisseur construit sur la dernière version de Claude Code 2.1.110 via un pipeline de patchs. Trois piliers : **protection de la vie privée** (zéro télémétrie), **pureté** (aucun résidu amont), **égalité technologique** (toutes les fonctionnalités débloquées pour chaque utilisateur).

```
sillyx    → OpenAI Codex (ChatGPT Pro)
sillye    → Claude (claude.ai)

sillyxs / sillyes   → mêmes fournisseurs, --dangerously-skip-permissions
```

### Démarrage rapide

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
silly doctor
sillyx    # ou sillye
```

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1 | iex
silly doctor
sillyx    # ou sillye
```

### Différences avec Claude Code

| | Claude Code | Silly Code |
|---|---|---|
| Fournisseurs | Claude uniquement | Claude + Codex |
| Télémétrie | 10+ endpoints | Tous bloqués |
| Verrouillage | Par niveau | Max + `/loop` déverrouillés |
| Fuites d'identité | Marque incrustée | Retirées des prompts LLM |
| Source | Binaire compilé | 102 patchs, entièrement vérifiable |

### Commandes de gestion

```bash
silly status          # État d'authentification des fournisseurs
silly login <prov>    # Connexion (codex/claude)
silly logout <prov>   # Supprimer les jetons
silly doctor          # Diagnostic complet
silly uninstall       # Désinstallation complète
```

### Prérequis

- macOS, Linux ou Windows PowerShell 7+
- Au moins un abonnement : ChatGPT Pro ou Claude Pro/Max
- [Node.js](https://nodejs.org/) >= 20 et Git
- [ripgrep](https://github.com/BurntSushi/ripgrep) est auto-installé s'il manque sur les plateformes prises en charge

---

## License

MIT
