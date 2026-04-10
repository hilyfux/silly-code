# 二进制审计报告 — cli.js v2.1.100

## 隐私泄露端点（需全部阻断）

| # | URL | 用途 | 当前状态 |
|---|-----|------|----------|
| 1 | `api.anthropic.com/api/eval/sdk-*` | Statsig 遥测 | ✅ 已阻断 (patch 30) |
| 2 | `api.anthropic.com/api/claude_code/metrics` | 使用指标上报 | ✅ 已阻断 (patch 31) |
| 3 | `api.anthropic.com/api/claude_code_shared_session_transcripts` | 会话分享 | ✅ 已阻断 (patch 32) |
| 4 | `api.anthropic.com/api/claude_cli_feedback` | 反馈上报 | ✅ 已阻断 (patch 33) |
| 5 | `api.anthropic.com/api/claude_code/organizations/metrics_enabled` | 指标开关检查 | ✅ 已阻断 (patch 34) |
| 6 | `http-intake.logs.us5.datadoghq.com/api/v2/logs` | **Datadog 日志** | ❌ 未处理 |
| 7 | `cdn.growthbook.io` | **GrowthBook 功能标记拉取** | ❌ 未处理 |
| 8 | `storage.googleapis.com/claude-code-dist-*/claude-code-releases` | **自动更新检查** | ❌ 未处理 |
| 9 | `raw.githubusercontent.com/anthropics/claude-plugins-official/*/stats/plugin-installs.json` | **插件统计** | ❌ 未处理 |
| 10 | `raw.githubusercontent.com/anthropics/claude-code/*/CHANGELOG.md` | **更新日志拉取** | ❌ 未处理 |
| 11 | `beacon.claude-ai.staging.ant.dev` | **Staging beacon** | ❌ 未处理 |
| 12 | `HEAD api.anthropic.com` | 连通性检查 | ⚠️ 无数据但浪费时间 |

## 平台上下文窗口

| Provider | 模型 | Context Window | Max Output |
|----------|------|:-------------:|:----------:|
| Claude | claude-sonnet-4-6 | 200,000 | 16,384 |
| Claude | claude-opus-4-6 | 200,000 | 16,384 |
| Claude | claude-haiku-4-5 | 200,000 | 8,192 |
| Codex/OpenAI | gpt-4o | 128,000 | 16,384 |
| Codex/OpenAI | gpt-4o-mini | 128,000 | 16,384 |
| Copilot | gpt-4o (via Copilot) | ~32,000* | ~4,096* |

*Copilot 通过 GitHub API 代理，窗口和输出可能有额外限制。

## Tier 控制点

| 函数 | 作用 | 调用次数 | 状态 |
|------|------|:--------:|------|
| `XK()` | 返回订阅类型 (max/pro/team/enterprise/null) | 核心 | ✅ 已修改→"max" |
| `WR()` | isMax 检查 | 8 | ✅ 自动通过 |
| `DR()` | isPro 检查 | 9 | ✅ 自动通过 |
| `m7()` | isSubscriber 检查 | 多 | ✅ 已修改→true |
| `D$()` | isFirstParty 检查 | 多 | ✅ 已扩展 |
| `fg()` | provider family 检查 | 多 | ✅ 已扩展 |

## GrowthBook Feature Flags

- 41 处引用 GrowthBook
- SDK 从 `cdn.growthbook.io` 拉取 flag 配置
- 需要拦截并返回"全开"默认值

## 模块化改造需求

当前 `patch.cjs` 问题：
1. 单文件 270+ 行，职责混合
2. 无测试 — 不知道哪个补丁会因上游更新而失败
3. 变量名硬编码 — 每次版本升级都要手动更新
4. 无版本检测 — 不知道上游是否已更新

## 版本升级工作流（需建设）

```
1. npm pack @anthropic-ai/claude-code → 获取新版
2. 自动检测变量名变化（landmark 字符串定位）
3. 运行 patch pipeline
4. 自动验证（每个 patch 的 pattern 是否命中）
5. 端到端测试（三个 provider 各跑一次）
6. 编译 binary
```
