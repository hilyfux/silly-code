---
date: 2026-04-23
branch: 1.0.0.0
status: active
scope: cross-session roadmap
supersedes: —
---

# Multi-Provider Ecosystem Blueprint

## Vision

**任何大模型完美使用 claude-code 生态**。短期目标是 GPT 在 claude-code 里**超越 Claude**（不仅 parity），中期是 Gemini 为配置即插件，长期是任一第三方 provider（DeepSeek / Qwen / 自建 OpenAI-compatible endpoint）能通过单一 `.cjs` config + 一对 launcher 落地。

## 五大设计原则（hard constraints）

1. **极高内聚** — 每 patch / provider / 测试单一职责
2. **极低耦合** — provider 改动不触发 branding / privacy / equality 层 regression
3. **极强鲁棒性** — 任何平台 / 任何 provider 失败 fail-fast，测试锁
4. **隐私安全** — 10 endpoint block 永不回退；Claude firstParty 身份 byte-identical 不漂
5. **技术平权** — 无 tier gating；ChatGPT Pro / Plus / API 权利对等
6. **无隐藏暗门** — 所有 patch / observation / network call 审计可见；no telemetry

## 当前状态（2026-04-23 baseline）

### 已完成
- silly-code pipeline 131 patches 稳定落到 pinned 2.1.114
- OpenAI Codex provider 完整支持（Responses API + Chat Completions）
- Claude firstParty 默认 fallback
- 16 npm test scripts + varmap parity（linux/win32）+ build-integrity 锁
- 5 MEMORY entry 系列涵盖历史踩坑（Mach-O blocker / codex 0.122-0.124 audits / platform divergence etc.）

### 已阻塞
- **A/claude-code upgrade**: 2.1.116+ Mach-O packaging — Phase 0 B1 Hybrid spike verified extraction works，repack 5 步 clist 待做
- **B/codex 0.124**: alpha park confirmed，stable 后重审

### 本次 session 即将落地（cycle-2）
- **C1/sillye pollution fix**: `branding.cjs` 09a-09p / 06b / 08b 识别类 patch 加 firstParty IIFE guard（R-A F1）
- **C2/hook channel extension**: `tameSkillPrompts` 4 → 10 hooks（R-C D1）
- **C3/cross-platform test guards**: keychain / CI parity / cron label（R-D E1/E2/E3）

## 五个子系统架构状态（Grade B 抽象层）

R-E 研究认证整体架构 Grade **B** — 数据驱动、迭代 `providers.filter(...)` 模式广泛覆盖 ~85% 代码。

### 三处真正 hardcoded leak（阻挡 "config-only" 新 provider）

| ID | 位置 | 问题 | 修复成本 |
|----|------|------|---------|
| L1 | `pipeline/patches/auth-bypass.cjs:36` | 硬 `if(process.env.CLAUDE_CODE_USE_OPENAI)` | ~10 LOC，改迭代 `sorted.map(p => p.envKey)` |
| L2 | `pipeline/patches/provider-ux.cjs:62-126` | 5 处 `uq()==="openai"` + 硬 GPT menu list | ~40 LOC，提升到 `provider.menuItems` config 字段 |
| L3 | `bin/silly-launcher.js:97-101,131-133,207-252,306-333` | 硬 `providers = {sillyx, sillye}` dispatch 表 + authKey enum | ~30 LOC，改 registry 驱动 |

**修 3 处 ≈ 80 LOC，换来 Gemini 为配置即插件**。

### 四处 `_base.cjs` 提升候选（provider-agnostic 能力回流）

当前以下仅 OpenAI 消费，应提升到 `_base.cjs` 让未来所有 non-firstParty provider 免费用：

1. **Observation bridge** (`openai.cjs:297-311, 370-382`)
   - `buildRequestObservation(req, tools)` + `attachResponseObservation(_r, _obs, _obsPath)`
   - 影响：~80 行提升，消费者改 3 行
2. **Failure dump triad** (`openai.cjs:285-355,339-408`)
   - `makeProviderDumper(providerKey)` 返回 { requestDump, errorDump, rejectionDump }
   - 任何 provider 一个 import 三个 dump 立即可用
3. **429 retry + AbortSignal composite** (`openai.cjs:319-364`)
   - `sillyFetchWithRetry(url, init, { upSignal, perAttemptMs, maxAttempts })`
   - 网络层通用鲁棒性
4. **Subagent demotion table** (概念上)
   - `remapForSubagent(model, providerConfig)` 根据 `providerConfig.subagentDemotions`
   - MEMORY `project-sillyx-skill-subagent-gap` 的 haiku → gpt-5.3-codex 永久 remap 是 OpenAI-specific 的案例，但机制可通用

## Claude firstParty 回流（sillye 经验受益）

R-B 研究发现：**sillye 无任何 dump 渠道**，Track 1 observability 完全空白。这违反 CLAUDE.md 的 "two-track synchronized" invariant。

### 短期（v1，下 session）
- **sillye dump parity** — 在 `claude.cjs` 加轻量 observer hook，wrap upstream fetch，写 `$SILLY_CODE_DATA/debug/{stamp}-claude-request.json`（OR 统一 tmpdir）
- **统一 dump 目录** — 目前 `openai.cjs` 写 `os.tmpdir()/silly-debug/`，但用户直觉寻找 `~/.silly-code/debug/` — 挑一个锁定 + compat test
- **命名 convention** — `*-codex-*.json` → `*-{providerKey}-*.json`，`silly report` 单 prefix 扫

### 中期（v2）
- **`silly observe summary`** 聚合器 — 扫 dump 目录输出 per-provider observation 指标
- **Budget tracker 提升到 sillye** — `agentBudgetLog` 已 provider-agnostic，只欠 firstParty 消费点

## "超越 Claude" 的 5 个 GPT-specific 方向（R-C + R-E）

按 payoff / effort 排：

| # | 方向 | Effort | Payoff | 备注 |
|---|------|--------|--------|------|
| 1 | Hook → observation bridge | 2-4 hr | 高 | 观测 `[HOOK CONTEXT]` 前缀 + flip `observed_hook_fired` |
| 2 | `PostToolBatch`-aware continuation | 4-8 hr | 高 | GPT 擅长 batch 总结；注入 `[BATCH SUMMARY REQUESTED]` hint |
| 3 | Skill lifecycle triple dump | 4-8 hr | 中 | `skill_invoke → tool_calls → skill_complete` 聚合成单 dump 项 |
| 4 | `CLAUDE_CODE_FORK_SUBAGENT` cross-provider | 8-16 hr | 中 | 2.1.117+ feature，先解 Mach-O blocker |
| 5 | `mcp_tool` hook-type passthrough | 16+ hr | 低 | 2.1.118 新 hook 类型，需要 `${path}` 插值层 |

## 跨平台 parity 路线图（R-D 12 gaps）

### 本次加固（test-only）
- **E1**: Keychain symmetric login contract guard
- **E2**: CI Windows test coverage allowlist guard（9 纯 Node 测试 Windows 跑 vs 显式 allow skip）
- **E3**: Windows cron label parity invariant

### 下 session 落地
- **C1/C10 HIGH**: Windows 自动 upgrade — 写 Task Scheduler 等价 `install-upgrade-cron.ps1`
- **C4 MED**: `install-upgrade-cron.sh` Git Bash 兜底 —  Windows `uname -s=MINGW64*` 时 actionable message
- **C6 LOW**: ripgrep ARM Windows 404 — 检测 asset 存在再下载
- **C5 MED**: sharp 运行时未触 assertion

### 长期
- CI 矩阵扩到 ARM Windows / Linux musl / macOS x64

## 下 session 推荐路线

按 value-weighted priority:

1. **Claude-code Phase 0 B1 repack PoC**（unblock upstream）
2. **L1 + L2 + L3 abstraction leak fix**（80 LOC，Gemini 为配置即插件）
3. **`_base.cjs` 提升 observation / dump / retry**（4 处共 ~200 LOC）
4. **sillye dump parity**（Track 1 回流）
5. **Windows Task Scheduler 支持**（cron parity）
6. **Codex 0.124 stable audit**（when released）

## Session-to-session handoff 约定

每轮在 `memory/project-<topic>-milestone.md` 留：
- 当前 commits（hash + one-line）
- 新踩坑进 MEMORY entry（single-purpose 文件）
- 剩余 work 作为下 session 入口（spec 指向 + checklist）

## Non-goals（永远不做）

1. 绕开 Anthropic 服务端 integrity 检查（如 firstParty 身份字符串篡改）
2. 引入任何 telemetry / external tracking
3. 为单一 provider 优化破坏其他 provider 路径
4. tier gating / account-state 读取（patch 52 env-opt-in 例外）
5. 修改 `pipeline/upstream/` 内容
