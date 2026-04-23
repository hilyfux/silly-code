---
date: 2026-04-23
branch: 1.0.0.0
status: active
scope: design note + gap analysis
related: project-sillyx-runtime-observation-bridge (MEMORY)
---

# Runtime Dump Bridge v0 — Design Note + Gap Analysis

## Context

`project-sillyx-runtime-observation-bridge` (MEMORY) 指出：skill/subagent 评估必须升级到
response-observed 证据，而不是停在 request-side 占位字段。本 note 盘点 **当前** silly-code
runtime dump 的实际接线，区分 **已落地** 与 **未落地** 两部分，并给出下 session 的最小执行
清单。

## Current state (evidence-based)

### OAuth Codex path — fully instrumented

`pipeline/patches/providers/openai.cjs:272-311` 在每次 OAuth Codex 请求都写一份
`{stamp}-codex-request.json` 到 `$TMPDIR/silly-debug/`。**无 env 门控**（line 272-275 显式注释
"Unconditional request-shape dump (no env flag required)"）。

初始写入字段（line 287-309）包含：

- `ts`, `url`, `model`, `stream`, `body_size`
- `instructions_len`, `input_item_count`, `input_preview`
- `tools_count`, `tool_names`
- `observed_skill_call: false` (placeholder)
- `observed_skill_completed: false` (placeholder)
- `observed_toolsearch_call: false` (placeholder)
- `observed_followup_action: false` (placeholder)
- `observed_agent_spawn: false` (placeholder)
- `hint_skill_available`, `hint_toolsearch_available`, `hint_schedulewakeup_available`,
  `hint_agent_available`, `hint_continuation_present`
- `observation_status: 'request-captured'`
- `extra_fields` (schema drift canary)

响应侧更新（line 365-384）在 `_r.clone().text()` 上跑 5 条 regex，把 5 个 `observed_*`
placeholder 更新成真值，并把 `observation_status` 翻成 `'response-observed'`，重写同一份
dump 文件。

**结论**：`observed_skill_completed` (W3 fix, `5730101`) 已真实落盘。Response-observed 证据
bridge v0 在 OAuth Codex 主路径上 **已完成**。

### Additional dumps already in place

- `{stamp}-openai-request.json` — Anthropic-format 原始请求（系统 prompt、messages、tools），
  `SILLY_DEBUG_DUMP=1` 门控（openai.cjs:167-181）。
- `{stamp}-codex-fetch-error.json` — fetch 抛出（TLS/abort/DNS/socket reset）时的 raw err
  (openai.cjs:334-356)，无门控。
- `{stamp}-codex-rejection.json` — chatgpt.com HTTP !ok 时的状态 + body
  (openai.cjs:393-409)，无门控。

### `silly report` bundler

`bin/silly:371-417` — 把 `/tmp/silly-debug/*.json` 打包成匿名化 tarball，供用户提交 GitHub
issue。**纯搬运**：不解析 observation 字段，不聚合 skill-completion 率。

## Gaps (not landed)

### Gap 1 — Chat-completions (API key) path lacks observation dump

`openai.cjs:417-454` 的 API-key 分支直接 fetch `api.openai.com/v1/chat/completions`，未写任何
request/observation dump。若未来用户用裸 API key 跑 sillyx，无 response-observed 证据可聚合。

**优先级**：低。OAuth（ChatGPT Pro）是主用户路径，API-key 分支是边缘 case。

### Gap 2 — `silly report` 不聚合 observation 字段

当前 `silly report` 只搬文件。下游诊断还需要人工 grep 或写 one-off node 脚本。未来可加一个
`silly observe summary` 子命令，打印：

- 过去 N 条请求里 `observed_skill_call` 命中率
- `observed_skill_call=true` 但 `observed_skill_completed=false` 的百分比（= Skill 被调但
  没跑完，主要信号）
- `observed_agent_spawn` 命中率 + subagent prompt identity 漂移率

**优先级**：中。这是 `project-sillyx-runtime-observation-bridge` 的真正 value-add，但写这个
子命令要新开 `pipeline/observe-summary.cjs` 并配一条 npm test，不属于 v0 minimal scope。

### Gap 3 — Non-OAuth (API key) response-observation parity

与 Gap 1 同源。如果补 Gap 1，chat-completions 响应侧也要 peek SSE 做 regex observation，或者
降级到 "request-side only，标记 `observation_status: 'request-only'`"。

**优先级**：低。跟随 Gap 1。

### Gap 4 — MEMORY 条目未更新

`project-sillyx-runtime-observation-bridge.md` 目前写的是 "评估要把 request dump 升级为
response-observed 证据，而不是停在占位字段"。W3 (`5730101`) + W4 (`f220266`) 已落地
`observed_skill_completed`；MEMORY 应该翻成 "bridge v0 landed (OAuth path only); Gap 1+2 open"。

**优先级**：高（MEMORY 是下 session 导航地图），但**不属于代码改动**，走 `/knowledge-graph`。

## Next session execution checklist

按优先级升序：

1. **Update MEMORY** — `project-sillyx-runtime-observation-bridge.md` 翻到 "v0 landed, Gap
   1+2 open" 状态。证据 link 到本 spec + commit `5730101`+ openai.cjs line range。
2. **[Optional] Ship `silly observe summary`** — 若下 session 目标是 skill-compat
   diagnostics，加 `pipeline/observe-summary.cjs` 读 `/tmp/silly-debug/*.json`，输出：
   - count, time range
   - observed_skill_call %, observed_skill_completed %
   - observed_agent_spawn %
   - top extra_fields (schema drift surface)
3. **[Optional] Chat-completions path parity** — 若用户反馈 API-key 路径需要诊断，把
   openai.cjs:417-454 改成和 OAuth 路径同样的 _obs/writeFileSync 两阶段。

## Decision (this session)

**Zero code change.** Bridge v0 已完整，Task 2 的实质 gap 是"**文档陈旧**"不是"代码缺失"。本
spec 替代一次 speculative 代码改动。Commit 只碰 `docs/superpowers/specs/`，不触发 `pipeline/`
patch 重跑。

## Verification

- `grep -rn "SILLY_DEBUG_DUMP\|observed_" pipeline/patches/providers/openai.cjs | head`
  confirms：7 observed_* 命中 (5 fields × request-init + 2 response-side updates = 7 lines
  incl. the 5 `false` placeholders).
- `tests/compat.test.cjs:737-740` 已 lock `observed_skill_call` / `observed_toolsearch_call`
  / `observed_followup_action` / `observed_agent_spawn` 存在于 build 后的 cli-patched.js 里。
- `node pipeline/patch.cjs` = 136 OK / 0 FAIL, `npm test` 16/16 PASS（这条 commit 未改
  patch/test，仅 docs/）。
