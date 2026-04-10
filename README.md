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
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/v0.1.0-rc1/install.sh | bash
silly doctor
sillyt    # or sillyx / sillye
```

### What's Different from Claude Code

| | Claude Code | Silly Code |
|---|---|---|
| Providers | Claude only | Claude + Codex + Copilot |
| Telemetry | Full | Zero |
| Feature locks | Tier-gated | All unlocked |
| Smart routing | None | Auto-selects best provider per task |
| Auto-failover | None | Switches provider on 429/5xx/timeout |
| Cost visibility | Overall only | Per-provider breakdown |
| Source | Compiled binary | Full source, runs from `bun` |

### Management

```bash
silly status          # Provider auth status
silly login <prov>    # Login (codex/copilot/claude)
silly logout <prov>   # Remove tokens
silly models          # Available models
silly doctor          # Full diagnostic
silly uninstall       # Remove completely
```

### In-Session Commands

```
/route    — Provider health + fallback + cost
/cost     — Per-provider cost breakdown
/model    — Switch model
/compact  — Compress context
/plan     — Plan mode
```

### Multi-Provider Architecture

- **Smart routing**: Best model per task type (reasoning → Opus, coding → Sonnet, fast → Haiku)
- **Auto-failover**: 429/5xx → automatically switch to next provider
- **Cost tracking**: Per-provider spend via `/cost`
- **Health monitoring**: Latency, failures, availability via `/route`

```bash
export CLAUDE_CODE_FALLBACK_POLICY=cross-provider     # default
export CLAUDE_CODE_FALLBACK_POLICY=same-provider-retry
export CLAUDE_CODE_FALLBACK_POLICY=strict
```

### Experimental Features

```bash
export SILLY_EXPERIMENTAL=1   # KAIROS, coordinator, proactive, daemon, etc.
sillyt --computer-use-mcp     # Computer use (macOS only)
```

### Requirements

- [Bun](https://bun.sh) >= 1.3.11 · [ripgrep](https://github.com/BurntSushi/ripgrep) (auto-installed)
- macOS or Linux (Windows via WSL)
- At least one subscription: ChatGPT Pro, GitHub Copilot, or Claude Pro/Max

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
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/v0.1.0-rc1/install.sh | bash
silly doctor
sillyt    # 或 sillyx / sillye
```

### 与 Claude Code 的区别

| | Claude Code | Silly Code |
|---|---|---|
| 供应商 | 仅 Claude | Claude + Codex + Copilot |
| 遥测 | 完整采集 | 零遥测 |
| 功能限制 | 按等级限制 | 全部解锁 |
| 智能路由 | 无 | 按任务类型自动选择最佳模型 |
| 自动故障转移 | 无 | 遇到 429/5xx 自动切换供应商 |
| 费用可见性 | 仅总计 | 按供应商分类明细 |
| 源码 | 编译二进制 | 完整源码，直接 `bun` 运行 |

### 管理命令

```bash
silly status          # 查看供应商认证状态
silly login <prov>    # 登录（codex/copilot/claude）
silly logout <prov>   # 删除认证令牌
silly models          # 查看可用模型
silly doctor          # 完整系统诊断
silly uninstall       # 完全卸载
```

### 会话内命令

```
/route    — 供应商健康状态 + 故障转移 + 费用
/cost     — 按供应商分类的费用明细
/model    — 切换模型
/compact  — 压缩上下文
/plan     — 计划模式
```

### 多供应商架构

- **智能路由**：按任务类型选择最佳模型（推理 → Opus，编码 → Sonnet，快速 → Haiku）
- **自动故障转移**：429/5xx 时自动切换到下一个供应商
- **费用追踪**：通过 `/cost` 查看各供应商花费
- **健康监控**：通过 `/route` 查看延迟、失败率、可用性

### 实验功能

```bash
export SILLY_EXPERIMENTAL=1   # 启用 KAIROS、协调器、主动建议等
sillyt --computer-use-mcp     # 计算机操控（仅 macOS）
```

### 环境要求

- [Bun](https://bun.sh) >= 1.3.11 · [ripgrep](https://github.com/BurntSushi/ripgrep)（自动安装）
- macOS 或 Linux（Windows 通过 WSL）
- 至少一个订阅：ChatGPT Pro、GitHub Copilot 或 Claude Pro/Max

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
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/v0.1.0-rc1/install.sh | bash
silly doctor
sillyt    # または sillyx / sillye
```

### Claude Code との違い

| | Claude Code | Silly Code |
|---|---|---|
| プロバイダー | Claude のみ | Claude + Codex + Copilot |
| テレメトリ | 完全収集 | ゼロ |
| 機能制限 | ティア別制限 | 全機能解放 |
| スマートルーティング | なし | タスクタイプ別に最適モデルを自動選択 |
| 自動フェイルオーバー | なし | 429/5xx で自動的にプロバイダーを切替 |
| コスト可視性 | 合計のみ | プロバイダー別内訳 |
| ソース | コンパイル済みバイナリ | フルソース、`bun` で直接実行 |

### 管理コマンド

```bash
silly status          # プロバイダー認証状態
silly login <prov>    # ログイン（codex/copilot/claude）
silly logout <prov>   # トークン削除
silly models          # 利用可能なモデル一覧
silly doctor          # 完全診断
silly uninstall       # 完全アンインストール
```

### セッション内コマンド

```
/route    — プロバイダーヘルス + フェイルオーバー + コスト
/cost     — プロバイダー別コスト内訳
/model    — モデル切替
/compact  — コンテキスト圧縮
/plan     — プランモード
```

### マルチプロバイダーアーキテクチャ

- **スマートルーティング**：タスク種別で最適モデルを選択（推論 → Opus、コーディング → Sonnet、高速 → Haiku）
- **自動フェイルオーバー**：429/5xx 時に次のプロバイダーへ自動切替
- **コスト追跡**：`/cost` でプロバイダー別支出を確認
- **ヘルス監視**：`/route` でレイテンシ・障害率・可用性を確認

### 実験的機能

```bash
export SILLY_EXPERIMENTAL=1   # KAIROS、コーディネーター、プロアクティブなど
sillyt --computer-use-mcp     # コンピューター操作（macOS のみ）
```

### 動作要件

- [Bun](https://bun.sh) >= 1.3.11 · [ripgrep](https://github.com/BurntSushi/ripgrep)（自動インストール）
- macOS または Linux（Windows は WSL 経由）
- 少なくとも1つのサブスクリプション：ChatGPT Pro、GitHub Copilot、または Claude Pro/Max

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
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/v0.1.0-rc1/install.sh | bash
silly doctor
sillyt    # ou sillyx / sillye
```

### Différences avec Claude Code

| | Claude Code | Silly Code |
|---|---|---|
| Fournisseurs | Claude uniquement | Claude + Codex + Copilot |
| Télémétrie | Complète | Zéro |
| Verrouillage | Par niveau | Tout déverrouillé |
| Routage intelligent | Non | Sélection automatique du meilleur modèle |
| Basculement auto | Non | Bascule sur 429/5xx/timeout |
| Visibilité coûts | Global seulement | Détail par fournisseur |
| Source | Binaire compilé | Source complète, exécution via `bun` |

### Commandes de gestion

```bash
silly status          # État d'authentification des fournisseurs
silly login <prov>    # Connexion (codex/copilot/claude)
silly logout <prov>   # Supprimer les jetons
silly models          # Modèles disponibles
silly doctor          # Diagnostic complet
silly uninstall       # Désinstallation complète
```

### Commandes en session

```
/route    — Santé des fournisseurs + basculement + coûts
/cost     — Ventilation des coûts par fournisseur
/model    — Changer de modèle
/compact  — Compresser le contexte
/plan     — Mode planification
```

### Architecture multi-fournisseur

- **Routage intelligent** : Meilleur modèle par type de tâche (raisonnement → Opus, code → Sonnet, rapide → Haiku)
- **Basculement automatique** : 429/5xx → bascule automatique vers le fournisseur suivant
- **Suivi des coûts** : Dépenses par fournisseur via `/cost`
- **Surveillance santé** : Latence, taux d'échec, disponibilité via `/route`

### Fonctionnalités expérimentales

```bash
export SILLY_EXPERIMENTAL=1   # KAIROS, coordinateur, proactif, etc.
sillyt --computer-use-mcp     # Utilisation de l'ordinateur (macOS uniquement)
```

### Prérequis

- [Bun](https://bun.sh) >= 1.3.11 · [ripgrep](https://github.com/BurntSushi/ripgrep) (auto-installé)
- macOS ou Linux (Windows via WSL)
- Au moins un abonnement : ChatGPT Pro, GitHub Copilot ou Claude Pro/Max

---

## License

MIT
