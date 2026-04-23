# Codex Parity Tracker

Status: active
Last reviewed: 2026-04-23

Purpose: capture OpenAI Codex changes that matter to sillyx without copying
Codex internals into the Claude Code patch pipeline. The bridge stays focused
on protocol translation, model mapping, privacy, and compatibility.

## 2026-04-23 Review

Evidence used:
- GitHub `openai/codex` releases page reports `0.121.0` as latest stable in
  the reachable release listing, with `0.122.0-alpha.*` pre-releases.
- The local global Codex wrapper is `@openai/codex@0.121.0`, but the platform
  optional package `@openai/codex-darwin-arm64` is missing, so local binary
  slug extraction cannot run until Codex is reinstalled.
- OpenAI's April 16, 2026 product note announces Codex app/desktop expansions:
  computer control, app/tool integrations, image generation, memory, PR review,
  multi-file/terminal views, SSH devboxes, in-app browser, and recurring work.

## Feature Triage

| Codex feature | silly-code stance | Reason |
|---|---|---|
| Marketplace/plugin installation | Watch | Useful ecosystem signal, but silly-code should preserve Claude Code plugin surfaces instead of importing Codex marketplace semantics into the binary patch layer. |
| MCP Apps, namespaced MCP, deferred tool calls | Have partial | Existing adapter tests lock `ToolSearch` preservation and `mcp__server__tool` name survival. Keep adding regression cases when upstream emits new tool-call shapes. |
| Memory controls / Chronicle-style local memory | Considered-not-worth now | Privacy default is zero telemetry and no hidden persistence. Any future memory feature must be explicit opt-in and local-first. |
| Computer control / desktop app operations | Considered-not-worth in CLI patch | This belongs to host/app tooling, not the patched Claude Code binary. Preserve MCP/tool schemas instead. |
| Image generation | Watch | Useful for frontend workflows, but should surface through normal tool/plugin capabilities, not hard-coded provider behavior. |
| Symlink-aware filesystem metadata | Watch | Relevant only if Claude Code upstream exposes comparable metadata to the provider adapter. No current bridge action. |
| Parallel MCP calls / sandbox state metadata | Watch | Preserve fields if they appear in request/response protocol; do not enable parallel tool calls for GPT by default because prior sillyx loops were more stable with serial tool execution. |

## Current Gaps

- Reinstall `@openai/codex` before the next model-table audit so the native
  binary is present and slug extraction can run.
- Do not promote any Codex model slug or request field to default behavior
  until it is validated against the actual endpoint sillyx calls:
  `chatgpt.com/backend-api/codex/responses` for OAuth, or Chat Completions for
  API-key mode.
- Keep skill/hook/subagent compatibility tests focused on signal preservation,
  not over-claiming runtime parity. Prompt/request preservation is necessary
  but not sufficient evidence that GPT invoked the right tool chain.
