# Silly Code — System Blueprint

> 这不是一份改造文档。这是我们自己的系统设计。
> Claude Code 是参考材料，不是基座。

## 哲学

### 技术平权

没有 Free 用户。没有 Pro 用户。没有 Max 用户。没有 Employee 特权。

所有能力，对所有人，完全开放。

Claude Code 把 ULTRATHINK、ULTRAPLAN、AGENT_TRIGGERS、CCR（code review）、KAIROS（multi-agent）等能力锁在 tier 后面。Anthropic 员工有特殊权限（内部工具、无限 context、调试模式、跳过权限检查）。

我们的立场：**如果一个能力在技术上是可行的，它就应该对所有用户开放。** 人为制造的稀缺性不是产品策略，是对用户的不尊重。

### 三条公理

1. **没有完美的模型** → 多 provider 是架构必须，不是可选项
2. **终端能做任何事** → 工具系统必须无限可扩展
3. **用户信任最稀缺** → 零遥测、透明执行、用户永远有最终控制权

---

## 系统身份

**silly-code** 是一个活在终端里的 AI 同事。

它能调用任何工具、连接任何模型、自主完成任何计算机操作。
Coding 是起点，不是边界。同一套引擎可以做研究、写作、数据分析、项目管理、系统自动化。

---

## 核心抽象

整个系统建立在 6 个类型上。所有其他概念（命令、插件、MCP、UI）都是这 6 个抽象的组合或视图。

### Provider — 模型来源

```typescript
interface Provider {
  id: ProviderId                    // 'claude' | 'codex' | 'copilot' | 'local' | string
  name: string                      // 显示名
  models: ModelDescriptor[]         // 可用模型列表
  capabilities: ProviderCapabilities // streaming, tools, vision, computer_use
  
  auth: AuthAdapter                 // OAuth PKCE / Device Flow / API Key / None
  health: HealthChecker             // ping, rate limit, latency tracking
  cost: CostTracker                 // per-token pricing, session accumulator
  
  createClient(config: ClientConfig): AnthropicCompatibleClient
}

interface ModelDescriptor {
  id: string                        // provider 原始 model ID
  canonical: CanonicalModel         // 'opus' | 'sonnet' | 'haiku' — 跨 provider 统一语义
  contextWindow: number
  maxOutput: number
  supportsTools: boolean
  supportsVision: boolean
  costPer1kInput: number
  costPer1kOutput: number
}
```

**设计决策：** Provider 是注册制。添加新 provider = 实现接口 + 调一次 `registerProvider()`。不需要改任何其他文件。Provider 之间的差异（OAuth 流程、token 格式、API 协议）全部封装在 Provider 内部。

### Conversation — 对话上下文

```typescript
interface Conversation {
  id: string
  messages: Message[]               // user + assistant + tool_result
  systemPrompt: SystemPrompt        // 动态组装
  metadata: {
    provider: ProviderId
    model: string
    tokenUsage: TokenUsage
    startedAt: number
  }
}
```

### Tool — AI 可执行的操作

```typescript
interface Tool {
  name: string
  description: string
  inputSchema: JSONSchema
  
  permission: PermissionLevel       // auto | ask | plan-only | deny
  isReadOnly: boolean
  
  execute(input: unknown, context: ToolContext): Promise<ToolResult>
}
```

**Tool 来源透明但统一：** 内置工具、MCP 工具、插件工具、用户自定义工具——对 Brain 层完全一致。

### Skill — 可复用策略

```typescript
interface Skill {
  name: string
  description: string
  whenToUse: string                 // activation condition
  prompt: string                    // 注入到 system prompt
  source: 'bundled' | 'plugin' | 'user'
}
```

### Agent — 自主执行实例

```typescript
interface Agent {
  id: string
  goal: string
  conversation: Conversation
  tools: Tool[]
  isolation: 'none' | 'worktree' | 'container'
  parent?: AgentId                  // 谁 spawn 了我
  status: 'running' | 'waiting' | 'done' | 'failed'
}
```

### Session — 一次使用的全部状态

```typescript
interface Session {
  id: string
  rootAgent: Agent                  // 主对话
  childAgents: Agent[]              // 子 agent
  memory: SessionMemory             // 跨轮次记忆
  config: UserConfig                // 用户设置
  transcript: TranscriptEntry[]     // 完整记录
}
```

---

## 系统分层

```
┌─────────────────────────────────────────────────────────┐
│  Layer 0: Shell                                         │
│  终端 UI · 输入解析 · 输出渲染 · 状态栏 · 主题           │
│  Ink/React · slash commands · keybindings               │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Brain                                         │
│  QueryEngine · system prompt 组装 · provider 选择        │
│  流式响应 · tool dispatch · 多轮迭代 · agent 编排        │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Hands                                         │
│  Tool Registry · 权限引擎 · 沙箱执行 · 结果验证          │
│  50+ 内置 · MCP bridge · 插件工具 · 用户自定义           │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Providers                                     │
│  Provider Registry · 多 provider 路由 · OAuth 生命周期    │
│  fetch adapter · 协议翻译 · 健康监控 · 成本追踪          │
├─────────────────────────────────────────────────────────┤
│  Layer 4: Memory                                        │
│  session 持久化 · 对话记录 · 用户偏好 · 项目知识          │
│  跨会话学习 · ~/.silly-code/ 数据目录                    │
├─────────────────────────────────────────────────────────┤
│  Layer 5: Extensions                                    │
│  Plugin system · MCP servers · IDE bridge · Voice       │
│  Computer Use · Workflow engine · Community marketplace  │
└─────────────────────────────────────────────────────────┘
```

**铁律：上层不知道下层的实现细节。**

- Shell 不知道用的是 Claude 还是 GPT
- Brain 不知道 tool 是本地的还是 MCP 的
- Hands 不知道请求来自交互还是后台 agent
- Providers 不知道请求是 coding 还是 research

---

## 技术平权：具体实现

Claude Code 的 tier 系统及我们的对策：

### 功能解锁

| 功能 | Claude Code 限制 | Silly Code |
|------|-------------------|------------|
| ULTRATHINK (extended thinking) | Max tier only | **所有用户** |
| ULTRAPLAN (planning mode) | Max tier only | **所有用户** |
| AGENT_TRIGGERS (agent loops) | Max tier only | **所有用户** |
| CCR (code review agent) | Pro+ only | **所有用户** |
| KAIROS (multi-agent orchestration) | Employee only | **所有用户** |
| VOICE_MODE | Pro+ only | **所有用户** |
| COMPUTER_USE | Beta/limited | **核心能力** |
| MCP_RICH_OUTPUT | Gated | **所有用户** |
| AWAY_SUMMARY | Gated | **所有用户** |
| BASH_CLASSIFIER | Gated | **所有用户** |
| VERIFICATION_AGENT | Gated | **所有用户** |

### 遥测根除

| Claude Code 遥测 | 我们的处理 |
|-------------------|-----------|
| OpenTelemetry spans | **不存在** — 代码中无遥测调用 |
| Sentry error reporting | **不存在** — 错误只显示给用户 |
| GrowthBook feature flags | **不存在** — 所有 flag 编译时确定 |
| Statsig analytics | **不存在** — 无外发统计 |
| Usage reporting | **不存在** — 用户自己看 cost tracker |

### Employee 特权开放

Anthropic 员工在 Claude Code 中有这些特权：

| Employee 特权 | 我们怎么做 |
|---------------|-----------|
| 内部调试模式 (isDebugToStdErr) | **所有用户可用** — `SILLY_DEBUG=1` |
| 跳过 permission 检查 | **所有用户可用** — `--dangerously-skip-permissions` |
| 无限 context window | **受 provider 限制，不受人为限制** |
| 内部工具 (@ant/ packages) | **开源替代** — 不依赖内部包 |
| Feature flag override | **所有用户可用** — `--feature=FLAG_NAME` |
| Rate limit bypass | **不存在** — rate limit 由 provider 决定，不由我们加码 |
| 特殊 model 访问 | **用户自己的 API key/OAuth 决定能用什么模型** |

---

## 数据流

### 请求生命周期

```
用户输入
    │
    ▼
[Shell] 解析输入类型
    ├── slash command → Command Registry → execute → render
    ├── file/url → 预处理 → 注入到 prompt
    └── natural language prompt ──┐
                                  │
    ┌─────────────────────────────▼──┐
    │ [Brain] QueryEngine            │
    │  1. 组装 system prompt         │
    │     - 基础规则                  │
    │     - 当前目录 context          │
    │     - 激活的 skills             │
    │     - CLAUDE.md / project rules │
    │  2. 选择 provider              │
    │     - 用户指定 > 智能路由 > 默认│
    │  3. 构造 API client            │
    │     - Provider.createClient()  │
    │  4. 发送请求                    │
    │     - stream: true             │
    │  5. 处理响应流                  │
    │     ├── text → 渲染到终端      │
    │     └── tool_use → dispatch    │
    └────────────┬──────────────────┘
                 │ tool_use
    ┌────────────▼──────────────────┐
    │ [Hands] Tool Registry          │
    │  1. 查找 tool (内置/MCP/插件)  │
    │  2. 权限检查                   │
    │     - auto: 直接执行           │
    │     - ask: 提示用户            │
    │     - deny: 拒绝              │
    │  3. 执行                      │
    │  4. 返回 tool_result          │
    └────────────┬──────────────────┘
                 │ tool_result
                 ▼
    [Brain] 继续对话 → 可能更多 tool calls → 最终回答
                 │
                 ▼
    [Shell] 渲染最终输出 · 更新 cost · 存储 transcript
```

### Provider 路由（智能选择）

```
任务到达
    │
    ▼
分类任务类型：
    ├── 深度推理 → prefer Opus / o1
    ├── 代码生成 → prefer Sonnet / GPT-4o
    ├── 快速补全 → prefer Haiku / GPT-4o-mini
    ├── 成本敏感 → prefer 最便宜的可用 provider
    └── 用户指定 → 使用指定 model
    │
    ▼
检查 provider 健康：
    ├── rate limited? → failover
    ├── down? → failover
    └── healthy → 继续
    │
    ▼
构造 client → 执行 → timeout + retry
```

---

## 技术栈

| 层 | 技术 | 为什么 |
|----|------|--------|
| Runtime | Bun 1.3+ | 快启动、原生 TS、内置 test runner |
| UI | Ink + React | 终端 UI 组件模型 |
| Build | Bun bundler | 单文件编译、feature flag via DCE |
| Language | TypeScript strict | 全代码库类型安全 |
| Auth | OAuth PKCE / Device Flow | 不需要用户管理 API key |
| IPC | Unix domain sockets | agent 间通信 |
| Search | ripgrep | 快速文件搜索（系统 binary） |
| State | JSON files in ~/.silly-code/ | 简单、无数据库依赖 |
| Tests | bun:test | 零配置、快速 |
| Distribution | bun compile → single binary | 一个文件，拷贝即用 |

---

## 安全模型

| 边界 | 保护 |
|------|------|
| Auth tokens | ~/.silly-code/ 目录 0600 权限 |
| Provider keys | 永不存储明文 API key；优先 OAuth token |
| Tool 执行 | 权限引擎：auto / ask / plan-only / deny |
| 文件访问 | sandbox-aware，可配置 allow/deny 模式 |
| 网络 | **零外发遥测** — 只有 provider API 调用 |
| 插件 | Plugin sandbox（未来：capability-based） |
| 安装 | 纯用户态 ~/.local/ — 不需要 sudo |

---

## 模块映射

当前代码库到架构层的映射：

### Layer 0: Shell
```
src/entrypoints/cli.tsx      — CLI 入口、fast-path 路由
src/screens/REPL.tsx         — 主交互界面
src/components/              — 终端 UI 组件
src/hooks/                   — React hooks
```

### Layer 1: Brain
```
src/QueryEngine.ts           — 核心编排引擎
src/assistant/               — KAIROS 多 agent 编排
src/skills/                  — Skill 系统
```

### Layer 2: Hands
```
src/tools.ts                 — Tool 注册表
src/tools/                   — 54 个 tool 实现
src/commands.ts              — Command 注册表
src/commands/                — 109 个 command 实现
```

### Layer 3: Providers
```
src/services/provider/       — Provider 注册表、类型、路由
src/services/api/            — API client 工厂、fetch adapter
src/services/oauth/          — OAuth 流程（Anthropic/Codex/Copilot）
src/constants/               — Provider 常量（分文件隔离）
src/utils/model/             — Model 映射、配置
```

### Layer 4: Memory
```
src/state/                   — 应用状态
src/services/SessionMemory/  — 会话记忆
src/services/extractMemories/— 记忆提取
src/services/compact/        — Context 压缩
```

### Layer 5: Extensions
```
src/plugins/                 — 插件系统
src/services/mcp/            — MCP 协议集成
src/bridge/                  — IDE bridge
src/voice/                   — 语音输入
src/tasks/                   — 后台任务
src/daemon/                  — 守护进程
```

---

## 构建系统

### Feature Flags — 全部开放

```typescript
// scripts/build.ts — silly-code 的 feature flags 策略
//
// Claude Code 用 GrowthBook 远程控制 flags，按 tier 开放。
// 我们在编译时把所有 flags 打开。没有远程控制。没有 tier 检查。

const ALL_FLAGS = [
  'AGENT_MEMORY_SNAPSHOT',    // agent 记忆快照
  'AGENT_TRIGGERS',           // agent 触发器（/loop）
  'AWAY_SUMMARY',             // 离开时自动总结
  'BASH_CLASSIFIER',          // bash 命令分类
  'BRIDGE_MODE',              // IDE bridge
  'CCR_PARALLEL_REVIEWS',     // 并行代码审查
  'CCR_PR_COMMENT',           // PR 评论
  'LODESTONE',                // 项目导航
  'MCP_RICH_OUTPUT',          // MCP 富输出
  'ULTRAPLAN',                // 深度规划
  'ULTRATHINK',               // 深度思考
  'VERIFICATION_AGENT',       // 验证 agent
  'VOICE_MODE',               // 语音模式
  // ... 全部 37 个 flags
]

// 编译时全部启用。用户通过 --feature 可以单独关闭。
// 没有远程 kill switch。代码在用户手里，flag 也在用户手里。
```

### 构建产物

```
bun run build        → ./cli           (开发用，快速迭代)
bun run build:dev    → ./cli-dev       (全 flag 开启)
bun run compile      → ./dist/silly    (单文件 binary，分发用)
```

---

## 路线图

### Phase 1: 根基稳固（当前）
- [x] 多 provider 架构（Claude + Codex + Copilot）
- [x] Provider 注册表和类型合约
- [x] 所有 feature flags 开放
- [x] 零遥测
- [x] 一键安装/卸载
- [ ] Provider adapter 端到端验证（Codex/Copilot 实际可用）
- [ ] 全项目审计 — 消除所有与 Claude Code 的能力不对齐
- [ ] 上游同步到最新版本

### Phase 2: 智能路由
- [ ] Provider 健康监控
- [ ] 按任务类型自动选 provider
- [ ] 成本实时追踪（每次请求显示花了多少钱）
- [ ] Provider failover（一个挂了自动切另一个）
- [ ] 多模型链（reasoning 用 Opus，coding 用 Sonnet，review 用 GPT）

### Phase 3: Computer Use — 真正的差异化
- [ ] 屏幕捕获 + OCR（理解屏幕上有什么）
- [ ] 鼠标/键盘自动化（点击、输入、滚动、拖拽）
- [ ] 浏览器自动化（导航、填表、提取数据）
- [ ] 应用控制（启动、切换、操作原生 app）
- [ ] 自纠正循环（执行 → 截图 → 验证 → 重试）

### Phase 4: 社区
- [ ] 开放插件市场
- [ ] 社区 skill 共享
- [ ] Session 导出/导入
- [ ] 团队共享 context
- [ ] 贡献指南

### Phase 5: 自主
- [ ] Local LLM 支持（Ollama adapter）
- [ ] 离线模式
- [ ] 后台 agent（daemon mode + real workers）
- [ ] 主动代码分析

### Phase 6: 平台
- [ ] Web UI
- [ ] Mobile companion
- [ ] CI/CD 集成
- [ ] Enterprise features（SSO、audit log）

---

## 成功标准

| 指标 | 目标 |
|------|------|
| 安装到首次使用 | < 60 秒 |
| Provider 切换 | < 1 秒 |
| 与 Claude Code 功能对齐 | > 95% |
| Claude Code 没有的独特能力 | >= 5 个 |
| 零遥测 | 永远 |
| 所有 tier 功能 | 全部开放 |
| Employee 特权 | 全部开放 |
